/**
 * Admin provisioning.
 *
 *   cd /var/www/bb-market
 *   sudo -u bbmarket -E NODE_ENV=production \
 *     SEED_ADMIN_PASSWORD='STRONG_PASS' npx tsx server/seed-admin.ts
 *
 * This is one of only two ways an admin account can be created. The other is
 * POST /api/admin/users, which requires an authenticated superadmin. No runtime
 * endpoint promotes a user: public registration always produces a customer
 * (see server/roles.ts).
 *
 * Why this is not a plain "insert if missing"
 * ------------------------------------------
 * The previous version looked each admin up by username only. `users.email` and
 * `users.username` are both NOT NULL UNIQUE, so if somebody registered an owner
 * address through the public form before provisioning ran, the insert aborted on
 * the email constraint and the script died part-way through, leaving the owner
 * locked out of their own store.
 *
 * The rules now implemented:
 *   1. Look the account up by EMAIL first.
 *   2. If that email already exists, promote that exact row instead of creating
 *      a second one, and clear any pending password-reset token.
 *   3. The password is reset when the row is being promoted, was created empty
 *      or un-hashed, or SEED_ADMIN_UPDATE_EXISTING is set. A plain re-run of an
 *      already-provisioned account leaves the current password alone, so a
 *      password the owner changed later is not silently reverted.
 *      Resetting on promotion is what makes the pre-registration attack harmless:
 *      the squatter keeps no usable password.
 *   4. If the email is free, create the admin. If the desired USERNAME is already
 *      held by some other email, that unrelated account is left untouched and a
 *      free alternative username is chosen.
 *   5. Running this repeatedly never creates duplicates.
 *   6. Only the exact emails listed below are ever touched.
 */
import { db, users } from "./db.js";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";

const scryptAsync = promisify(scrypt);

/** The accounts this script provisions. Nothing outside this list is touched. */
export type AdminSpec = {
    username: string;
    email: string;
    role: string;
};

export const ADMIN_ACCOUNTS: AdminSpec[] = [
    { username: "BBMarket", email: "bbmarket26@gmail.com", role: "superadmin" },
    { username: "Omar", email: "omar.hmida.lgl@gmail.com", role: "superadmin" },
];

export type ProvisionOutcome = "created" | "promoted" | "unchanged" | "repassworded";

export type ProvisionResult = {
    email: string;
    outcome: ProvisionOutcome;
    username: string;
    role: string;
    id: number;
    notes: string[];
};

async function hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const buf = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${buf.toString("hex")}.${salt}`;
}

/** A scrypt hash looks like "<128 hex>.<32 hex>"; anything else is unusable. */
function looksLikeHash(value: unknown): boolean {
    const stored = String(value ?? "");
    return /^[0-9a-f]{128}\.[0-9a-f]{32}$/i.test(stored);
}

function normaliseEmail(email: string): string {
    return String(email ?? "").trim().toLowerCase();
}

async function findByEmail(email: string) {
    const target = normaliseEmail(email);
    const rows = (await db.select().from(users)) as any[];
    // Exact match first, then case-insensitive, because the unique constraint is
    // on the raw column and "Omar@x.com" and "omar@x.com" can both exist.
    return (
        rows.find((r) => r.email === target) ??
        rows.find((r) => normaliseEmail(r.email) === target) ??
        null
    );
}

async function findByUsername(username: string) {
    const rows = (await db.select().from(users)) as any[];
    return rows.find((r) => r.username === username) ?? null;
}

/**
 * Pick a free username, appending -2, -3, ... to the preferred one.
 * Returns null if nothing sensible is available, so the caller can fail loudly
 * instead of clobbering somebody else's account.
 */
async function findFreeUsername(preferred: string): Promise<string | null> {
    for (let suffix = 1; suffix <= 50; suffix += 1) {
        const candidate = suffix === 1 ? preferred : `${preferred}-${suffix}`;
        if (!(await findByUsername(candidate))) return candidate;
    }
    return null;
}

/**
 * Provision the admin accounts. Idempotent: safe to run repeatedly.
 */
export async function provisionAdmins(accounts: AdminSpec[] = ADMIN_ACCOUNTS): Promise<ProvisionResult[]> {
    // Fail fast: never fall back to a known password for superadmin accounts.
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword) {
        throw new Error(
            "SEED_ADMIN_PASSWORD is required. Set it before running this script; " +
                "there is no default password for superadmin accounts.",
        );
    }
    const updateExisting =
        process.env.SEED_ADMIN_UPDATE_EXISTING === "1" ||
        process.env.SEED_ADMIN_UPDATE_EXISTING === "true";
    if (updateExisting) {
        console.warn(
            "[seed-admin] SEED_ADMIN_UPDATE_EXISTING is enabled: the password of an " +
                "already-provisioned account will be reset too.",
        );
    }

    const results: ProvisionResult[] = [];

    for (const admin of accounts) {
        const notes: string[] = [];
        const email = normaliseEmail(admin.email);

        // --- 1. Email is the identity key -------------------------------------
        const existing = await findByEmail(email);

        if (existing) {
            const roleChanged = existing.role !== admin.role;
            const passwordUsable = looksLikeHash(existing.password);
            // Reset the password whenever the row is gaining privileges, so an
            // account that was publicly registered cannot keep its own password
            // after being promoted.
            const mustResetPassword = roleChanged || !passwordUsable || updateExisting;

            if (existing.username !== admin.username) {
                notes.push(
                    `kept existing username "${existing.username}" (wanted "${admin.username}")`,
                );
            }

            const patch: Record<string, unknown> = {
                role: admin.role,
                // Any pending reset link is invalidated so a stale token cannot be
                // used to take over a freshly provisioned account.
                resetToken: null,
                resetTokenExpires: null,
            };
            if (mustResetPassword) {
                patch.password = await hashPassword(seedPassword);
            }

            await db.update(users).set(patch).where(eq(users.id, existing.id));

            const outcome: ProvisionOutcome = mustResetPassword
                ? roleChanged
                    ? "promoted"
                    : "repassworded"
                : "unchanged";

            results.push({
                email,
                outcome,
                username: existing.username,
                role: admin.role,
                id: existing.id,
                notes,
            });
            continue;
        }

        // --- 2. Create, but never steal an unrelated username ----------------
        let username = admin.username;
        const holder = await findByUsername(username);
        if (holder) {
            // The username belongs to a different account. Leave that account
            // completely alone and pick another username.
            const alternative = await findFreeUsername(admin.username);
            if (!alternative) {
                throw new Error(
                    `Cannot provision ${email}: username "${admin.username}" belongs to ` +
                        `another account (${holder.email}) and no free alternative could be ` +
                        `generated. Free the username or rename that account, then re-run.`,
                );
            }
            notes.push(
                `username "${admin.username}" already belongs to ${holder.email}; ` +
                    `that account was left untouched and "${alternative}" was used instead`,
            );
            username = alternative;
        }

        await db.insert(users).values({
            username,
            email: admin.email,
            password: await hashPassword(seedPassword),
            role: admin.role,
            resetToken: null,
            resetTokenExpires: null,
        });

        const inserted = await findByUsername(username);
        results.push({
            email,
            outcome: "created",
            username,
            role: admin.role,
            id: inserted?.id ?? 0,
            notes,
        });
    }

    return results;
}

function report(results: ProvisionResult[]) {
    const label: Record<ProvisionOutcome, string> = {
        created: "créé",
        promoted: "promové (mot de passe réinitialisé)",
        repassworded: "mot de passe réinitialisé",
        unchanged: "existe déjà, inchangé",
    };
    for (const r of results) {
        console.log(`  ${r.email} -> ${r.username} [${r.role}] : ${label[r.outcome]}`);
        for (const note of r.notes) console.log(`      note: ${note}`);
    }
}

/** Only run when executed directly, so the regression tests can import this. */
function isDirectInvocation(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return path.resolve(entry) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
}

if (isDirectInvocation()) {
    provisionAdmins()
        .then((results) => {
            console.log("--- Seeding Admins ---");
            report(results);
            console.log("--- Seeding Terminé ---");
            process.exit(0);
        })
        .catch((err) => {
            console.error("Erreur seeding:", err);
            process.exit(1);
        });
}
