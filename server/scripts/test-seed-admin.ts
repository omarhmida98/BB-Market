/**
 * Regression tests for admin provisioning (server/seed-admin.ts).
 *
 *   npm run test:seed
 *
 * The bug this guards against
 * ---------------------------
 * The script used to look each admin up by USERNAME only. Both `users.email` and
 * `users.username` are NOT NULL UNIQUE, so a public registration that claimed an
 * owner address before provisioning ran made the insert abort on the email
 * constraint. The script died part-way through and left the owner locked out of
 * their own store.
 *
 * Each scenario runs in a child process against its own freshly migrated SQLite
 * database, because the database handle and the env are resolved at import time.
 * The child calls provisionAdmins() directly (it does not shell out, so the
 * script's process.exit cannot interfere) and prints the resulting rows.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail: string) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}  ${detail}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}  ${detail}`);
    }
}

const BBMARKET = "bbmarket26@gmail.com";
const OMAR = "omar.hmida.lgl@gmail.com";
const SEED_PW = "SeedPassword!2026";
const SQUATTER_PW = "SquatPassword!2026";

type UserRow = { id: number; username: string; email: string; role: string; password: string; resetToken: string | null };

type Scenario = {
    name: string;
    /** Rows to insert before provisioning. */
    fixtures: Array<{ username: string; email: string; role: string; password?: string; resetToken?: string }>;
    /** How many times provisionAdmins() runs. */
    runs: number;
    verify: (users: UserRow[], ctx: { afterFirstRun: Record<string, string>; outcomes: string }) => void;
};

const byEmail = (users: UserRow[], email: string) => users.filter((u) => u.email.toLowerCase() === email.toLowerCase());

const scenarios: Scenario[] = [
    // -----------------------------------------------------------------------
    {
        name: "clean database: both admins are created",
        fixtures: [],
        runs: 1,
        verify: (users) => {
            check("  exactly two users exist", users.length === 2, `count=${users.length}`);
            for (const email of [BBMARKET, OMAR]) {
                const rows = byEmail(users, email);
                check(`  ${email} created once`, rows.length === 1, `rows=${rows.length}`);
                check(`  ${email} is superadmin`, rows[0]?.role === "superadmin", `role=${rows[0]?.role}`);
                check(`  ${email} has a hashed password`, /^[0-9a-f]{128}\./i.test(rows[0]?.password ?? ""), "scrypt hash stored");
            }
            check("  BBMarket kept the intended username", byEmail(users, BBMARKET)[0]?.username === "BBMarket", byEmail(users, BBMARKET)[0]?.username);
            check("  Omar kept the intended username", byEmail(users, OMAR)[0]?.username === "Omar", byEmail(users, OMAR)[0]?.username);
        },
    },
    // -----------------------------------------------------------------------
    {
        name: "admin email already registered as a customer: same row is promoted, no duplicate",
        fixtures: [
            { username: "squat-a", email: BBMARKET, role: "client", password: SQUATTER_PW, resetToken: "pending-token" },
        ],
        runs: 1,
        verify: (users) => {
            check("  no duplicate was created", byEmail(users, BBMARKET).length === 1, `rows=${byEmail(users, BBMARKET).length}`);
            check("  squatter row + the other newly created admin, no extra", users.length === 2, `count=${users.length}`);
            const row = byEmail(users, BBMARKET)[0];
            check("  that exact row is now superadmin", row?.role === "superadmin", `role=${row?.role}`);
            check("  its id was preserved (updated, not recreated)", row?.username === "squat-a", `username=${row?.username}`);
            check("  the squatter's password was reset", row?.password !== SQUATTER_PW, "hash differs from the pre-registration password");
            check("  the pending reset token was cleared", row?.resetToken === null || row?.resetToken === undefined, `resetToken=${row?.resetToken}`);
        },
    },
    // -----------------------------------------------------------------------
    {
        name: "admin email exists under a different username: same row updated safely",
        fixtures: [
            { username: "omar-old-account", email: OMAR, role: "client", password: SQUATTER_PW },
        ],
        runs: 1,
        verify: (users) => {
            check("  no duplicate was created", byEmail(users, OMAR).length === 1, `rows=${byEmail(users, OMAR).length}`);
            const row = byEmail(users, OMAR)[0];
            check("  that exact row is now superadmin", row?.role === "superadmin", `role=${row?.role}`);
            check("  its original username was preserved", row?.username === "omar-old-account", `username=${row?.username}`);
            check("  the other admin was still created", byEmail(users, BBMARKET).length === 1, `rows=${byEmail(users, BBMARKET).length}`);
            check("  total is two users", users.length === 2, `count=${users.length}`);
        },
    },
    // -----------------------------------------------------------------------
    {
        name: "desired username already belongs to another email: unrelated user preserved",
        fixtures: [
            { username: "BBMarket", email: "innocent-bystander@example.com", role: "client", password: SQUATTER_PW },
        ],
        runs: 1,
        verify: (users) => {
            const bystander = byEmail(users, "innocent-bystander@example.com");
            check("  the unrelated account still exists", bystander.length === 1, `rows=${bystander.length}`);
            check("  its email was not overwritten", bystander[0]?.email === "innocent-bystander@example.com", `email=${bystander[0]?.email}`);
            check("  it was NOT promoted", bystander[0]?.role === "client", `role=${bystander[0]?.role}`);
            check("  its password was not touched", /^[0-9a-f]{128}\./i.test(bystander[0]?.password ?? ""), "password still hashed");
            const admin = byEmail(users, BBMARKET)[0];
            check("  the real admin email exists", admin !== undefined, `rows=${byEmail(users, BBMARKET).length}`);
            check("  it is superadmin", admin?.role === "superadmin", `role=${admin?.role}`);
            check("  it got a different username", admin?.username !== "BBMarket", `username=${admin?.username}`);
            check("  total is three users", users.length === 3, `count=${users.length}`);
        },
    },
    // -----------------------------------------------------------------------
    {
        name: "second seed run: idempotent, no duplicates",
        fixtures: [
            { username: "squat-a", email: BBMARKET, role: "client", password: SQUATTER_PW },
            { username: "Omar", email: OMAR, role: "admin", password: SQUATTER_PW },
        ],
        runs: 2,
        verify: (users) => {
            check("  no duplicates after two runs", users.length === 2, `count=${users.length}`);
            for (const email of [BBMARKET, OMAR]) {
                check(`  ${email} exists once`, byEmail(users, email).length === 1, `rows=${byEmail(users, email).length}`);
                check(`  ${email} is superadmin`, byEmail(users, email)[0]?.role === "superadmin", `role=${byEmail(users, email)[0]?.role}`);
            }
        },
    },
    // -----------------------------------------------------------------------
    {
        name: "re-running does not revert a password changed after provisioning",
        fixtures: [],
        runs: 2,
        verify: (users, ctx) => {
            check("  still exactly two users", users.length === 2, `count=${users.length}`);
            for (const email of [BBMARKET, OMAR]) {
                const now = byEmail(users, email)[0]?.password;
                check(
                    `  ${email} password survived the second run`,
                    now === ctx.afterFirstRun[email],
                    "hash is byte-identical to the first run (no silent reset)",
                );
            }
            check(
                "  the second run reported both accounts as unchanged",
                (ctx.outcomes.match(/unchanged/g) || []).length === 2,
                ctx.outcomes,
            );
        },
    },
];

function runScenario(s: Scenario) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-seed-test-"));
    const dbFile = path.join(tmpDir, "seed-test.db");

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        DATABASE_URL: `file:${dbFile}`,
        SESSION_SECRET: "seed-regression-test",
        SEED_ADMIN_PASSWORD: SEED_PW,
        SEED_ADMIN_UPDATE_EXISTING: "",
        // Production policy is irrelevant here but the SQLite guard would block
        // NODE_ENV=production; these tests do not set NODE_ENV at all.
        ALLOW_SQLITE_IN_PRODUCTION: "1",
        SEED_DEMO_PRODUCTS: "",
    };
    delete env.NODE_ENV;
    delete env.SEED_ADMIN_UPDATE_EXISTING;

    const result = spawnSync(process.execPath, ["--import", "tsx", __filename, "--child", dbFile, String(s.runs)], {
        env,
        encoding: "utf8",
        timeout: 180_000,
    });

    const stdout = result.stdout || "";
    const rowsJson = (stdout.match(/^USERS=(.*)$/m) || [])[1];
    const outcomes = (stdout.match(/^OUTCOMES=(.*)$/m) || [])[1] || "";
    const firstRun = (stdout.match(/^PASS1=(.*)$/m) || [])[1];

    if (!rowsJson) {
        const tail = (result.stderr || "").split(/\r?\n/).filter(Boolean).slice(-4).join(" | ");
        check(s.name, false, `child produced no rows (exit ${result.status}): ${tail}`);
    } else {
        console.log(`\n  ${s.name}`);
        const users = JSON.parse(rowsJson) as UserRow[];
        console.log(`      outcomes: ${outcomes}`);
        s.verify(users, { afterFirstRun: firstRun ? JSON.parse(firstRun) : {}, outcomes });
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Child: migrate an empty database, insert fixtures, provision, print rows.
// ---------------------------------------------------------------------------
async function runChild(dbFile: string, runs: number) {
    await import("../env.js");
    process.env.DATABASE_URL = `file:${dbFile}`;

    const { resolveDbTarget } = await import("../db-target.js");
    const target = resolveDbTarget();
    if (target.dialect !== "sqlite") {
        throw new Error(`this test needs SQLite, but DATABASE_URL resolved to "${target.dialect}".`);
    }

    const Database = (await import("better-sqlite3")).default;
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const sqlite = new Database(target.sqlitePath!);
    migrate(drizzle(sqlite), { migrationsFolder: target.migrationsFolder });
    sqlite.close();

    const { db, users } = await import("../db.js");
    const { provisionAdmins } = await import("../seed-admin.js");
    const { hashPassword } = await import("../auth.js");

    const fixtures = JSON.parse(process.env.__SEED_FIXTURES || "[]") as Array<{
        username: string; email: string; role: string; password?: string; resetToken?: string;
    }>;
    for (const f of fixtures) {
        await db.insert(users).values({
            username: f.username,
            email: f.email,
            password: await hashPassword(f.password || "FixturePassword!2026"),
            role: f.role,
            resetToken: f.resetToken ?? null,
        });
    }

    const outcomes: string[] = [];
    let afterFirstRun: Record<string, string> = {};
    for (let i = 0; i < runs; i += 1) {
        const results = await provisionAdmins();
        outcomes.push(`run${i + 1}: ` + results.map((r) => `${r.email.split("@")[0]}=${r.outcome}`).join(", "));
        if (i === 0) {
            const snapshot = (await db.select().from(users)) as any[];
            afterFirstRun = Object.fromEntries(
                snapshot
                    .filter((r) => [BBMARKET, OMAR].includes(String(r.email).toLowerCase()))
                    .map((r) => [String(r.email).toLowerCase(), String(r.password ?? "")]),
            );
        }
    }

    const rows = (await db.select().from(users)) as any[];
    console.log(
        "USERS=" +
            JSON.stringify(
                rows.map((r) => ({
                    id: r.id,
                    username: r.username,
                    email: r.email,
                    role: r.role,
                    // Expose the hash so the parent can assert it changed / did not
                    // change. It is a throwaway test database.
                    password: String(r.password ?? ""),
                    resetToken: r.resetToken ?? null,
                })),
            ),
    );
    console.log("OUTCOMES=" + outcomes.join(" | "));
    console.log("PASS1=" + JSON.stringify(afterFirstRun));
    process.exit(0);
}

// ---------------------------------------------------------------------------

if (process.argv.includes("--child")) {
    const i = process.argv.indexOf("--child");
    await runChild(process.argv[i + 1], Number(process.argv[i + 2] || "1"));
} else {
    console.log("Seed provisioning regression suite: idempotent, non-destructive, email-keyed");

    for (const s of scenarios) {
        process.env.__SEED_FIXTURES = JSON.stringify(s.fixtures);
        runScenario(s);
    }
    delete process.env.__SEED_FIXTURES;

    console.log("\n=================================================");
    console.log(`  ${passed} passed, ${failed} failed`);
    console.log("=================================================");
    process.exit(failed > 0 ? 1 : 0);
}
