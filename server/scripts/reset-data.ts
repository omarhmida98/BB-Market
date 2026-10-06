/**
 * Clears all business/test data from the LOCAL development database, keeping the
 * schema, the migrations, the settings and the provisioned admin accounts.
 *
 *   npm run db:reset-data              # dry run: prints what would happen
 *   npm run db:reset-data -- confirm   # backs up, then really clears
 *
 * Development only. It refuses to run when NODE_ENV=production and against any
 * PostgreSQL DATABASE_URL: production is PostgreSQL, so "SQLite file only" is
 * the simplest rule that can never reach it.
 *
 * What it does, in order:
 *   1. Works out which users survive: the accounts in `ADMIN_ACCOUNTS`
 *      (server/seed-admin.ts) that exist in this database. One that is absent
 *      is reported and skipped - a local database does not need every
 *      production admin, and this script never creates an account, because that
 *      needs a password it must not invent. It stops only if NONE of them
 *      exists, since clearing the users then would lock everybody out.
 *   2. Writes a timestamped backup to server/backups/ and verifies it.
 *   3. In ONE transaction: deletes the business tables children-first, deletes
 *      every user that is not one of the provisioned admins, and resets the
 *      autoincrement counters of the cleared tables. Any failed check rolls the
 *      whole thing back.
 *   4. Moves upload files no remaining row references into the backup folder
 *      (moved, not deleted, so the backup stays restorable with its images).
 *   5. Prints rows before / removed / after for every table.
 *
 * Kept as they are: `settings`, `social_media_embeds`, `__drizzle_migrations`.
 */
import "../env.js";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { resolveDbTarget } from "../db-target.js";
import { resolveUploadsDir } from "../paths.js";

const TAG = "[reset-data]";

function refuse(message: string): never {
  console.error(`${TAG} REFUSED: ${message}`);
  process.exit(1);
}

// --- Guards. These run before anything opens a database. ---------------------
if (process.env.NODE_ENV === "production") {
  refuse("NODE_ENV=production. This command only ever runs on a development machine.");
}
const target = resolveDbTarget();
if (target.dialect !== "sqlite" || !target.sqlitePath) {
  refuse("DATABASE_URL points at PostgreSQL. This command only works on a local SQLite file.");
}
const dbPath = target.sqlitePath;
if (!fs.existsSync(dbPath)) refuse(`database file not found: ${dbPath}`);

const confirmed = process.argv.slice(2).includes("confirm");

/**
 * Cleared completely, children first. `wishlist` references `products`, so it
 * goes before it; nothing else has a foreign key, but orders and the activity
 * log point at products and users by id, so they go before those too.
 */
const CLEAR_TABLES = [
  "notifications",
  "wishlist",
  "orders",
  "user_activities",
  "messages",
  "homepage_sections",
  "promos",
  "sticker_catalogs",
  "products",
  "categories",
] as const;

/** Never written to. Listed so the report shows them as untouched. */
const KEEP_TABLES = ["settings", "social_media_embeds", "__drizzle_migrations"] as const;

// The admin allowlist is the provisioning script's own list, so "who is an
// admin" has one definition. Imported lazily: that module opens the database,
// which must not happen before the guards above have passed.
const { ADMIN_ACCOUNTS } = await import("../seed-admin.js");
const keepEmails = ADMIN_ACCOUNTS.map((account) => account.email.trim().toLowerCase());

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const tableExists = (name: string) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const count = (handle: Database.Database, name: string) =>
  (handle.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c;

const clearTables = CLEAR_TABLES.filter(tableExists);
const reportTables = [...clearTables, "users", ...KEEP_TABLES.filter(tableExists)];
const before = Object.fromEntries(reportTables.map((name) => [name, count(db, name)]));

// --- 1. Which users survive. ---------------------------------------------------
type UserRow = { id: number; username: string; email: string; role: string };
const allUsers = db.prepare("SELECT id, username, email, role FROM users ORDER BY id").all() as UserRow[];
const isKept = (user: UserRow) => keepEmails.includes(String(user.email ?? "").trim().toLowerCase());
const kept = allUsers.filter(isKept);
const removedUsers = allUsers.filter((user) => !isKept(user));

const missing = keepEmails.filter((email) => !kept.some((user) => user.email.trim().toLowerCase() === email));
const notAdmin = kept.filter((user) => !["admin", "superadmin"].includes(user.role));

console.log(`${TAG} database : ${dbPath}`);
console.log(`${TAG} admins to keep (${keepEmails.length}): ${keepEmails.join(", ")}`);
for (const user of kept) console.log(`${TAG}   keep   #${user.id} ${user.email} [${user.role}]`);
for (const user of removedUsers) console.log(`${TAG}   remove #${user.id} ${user.email} [${user.role}]`);

for (const email of missing) console.log(`${TAG}   note: ${email} is not in this database; it is not created here`);

if (kept.length === 0 || notAdmin.length > 0) {
  for (const user of notAdmin) console.error(`${TAG} ${user.email} exists but has role "${user.role}", not an admin role`);
  db.close();
  refuse(
    "no usable admin account would be left, so nothing was changed.\n" +
      "  Provision one first (you choose the password):\n" +
      "    SEED_ADMIN_PASSWORD='...' npx tsx server/seed-admin.ts",
  );
}

// --- Dry run stops here. ------------------------------------------------------
if (!confirmed) {
  console.log(`\n${TAG} DRY RUN - nothing was changed. Rows that would be removed:`);
  for (const name of clearTables) console.log(`${TAG}   ${name.padEnd(22)} ${before[name]}`);
  console.log(`${TAG}   ${"users".padEnd(22)} ${removedUsers.length} of ${allUsers.length}`);
  console.log(`\n${TAG} To really clear the data:  npm run db:reset-data -- confirm`);
  db.close();
  process.exit(0);
}

// --- 2. Backup, verified before anything is deleted. -------------------------
const now = new Date();
const pad = (value: number) => String(value).padStart(2, "0");
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
  `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const backupDir = path.join(path.dirname(dbPath), "backups");
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `${path.basename(dbPath, ".db")}_before_reset_${stamp}.db`);

// SQLite's online backup, not a file copy: it yields a consistent snapshot even
// if another process still has the database open.
await db.backup(backupPath);
const backup = new Database(backupPath, { readonly: true });
const integrity = backup.pragma("integrity_check", { simple: true });
const mismatched = reportTables.filter((name) => count(backup, name) !== before[name]);
backup.close();
if (integrity !== "ok" || mismatched.length > 0) {
  db.close();
  refuse(`backup verification failed (integrity: ${integrity}; row mismatch in: ${mismatched.join(", ") || "none"}). Nothing was deleted.`);
}
console.log(`\n${TAG} backup written and verified: ${backupPath}`);

// --- 3. One transaction: all of it, or none of it. ---------------------------
const placeholders = keepEmails.map(() => "?").join(", ");
const removed: Record<string, number> = {};

db.transaction(() => {
  for (const name of clearTables) {
    removed[name] = db.prepare(`DELETE FROM "${name}"`).run().changes;
  }
  removed.users = db
    .prepare(`DELETE FROM users WHERE lower(trim(email)) NOT IN (${placeholders})`)
    .run(...keepEmails).changes;

  // Checked inside the transaction, so a surprise rolls everything back.
  const left = db.prepare("SELECT email, role FROM users").all() as { email: string; role: string }[];
  const admins = left.filter((user) => ["admin", "superadmin"].includes(user.role));
  if (left.length !== kept.length || admins.length !== kept.length) {
    throw new Error(`expected exactly ${kept.length} admin user(s) and no others, found ${left.length} user(s), ${admins.length} admin(s)`);
  }

  // New products, orders, ... start again at id 1. The users counter is left
  // alone on purpose: the kept admins keep their ids, and reusing a deleted
  // customer's id for a new account would attach nothing but confusion to it.
  if (tableExists("sqlite_sequence")) {
    const reset = db.prepare("DELETE FROM sqlite_sequence WHERE name = ?");
    for (const name of clearTables) reset.run(name);
  }
})();

const fkViolations = db.pragma("foreign_key_check") as unknown[];
if (fkViolations.length > 0) console.error(`${TAG} WARNING: foreign key check reported ${fkViolations.length} problem(s)`);

// Deleted rows otherwise linger in the file's free pages; this rewrites it
// without them, so removed customer details are really gone from this file.
db.exec("VACUUM");

// --- 4. Uploads nothing references any more. ---------------------------------
const uploadsDir = resolveUploadsDir();
const moved: string[] = [];
const stillUsed: string[] = [];
if (fs.existsSync(uploadsDir)) {
  // Every `/uploads/<file>` mentioned by any text column of any remaining row.
  const referenced = new Set<string>();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
  for (const name of tables) {
    for (const row of db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
      for (const value of Object.values(row)) {
        if (typeof value !== "string") continue;
        for (const match of value.matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) referenced.add(match[1]);
      }
    }
  }

  const uploadsBackup = path.join(backupDir, `uploads_before_reset_${stamp}`);
  for (const entry of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    if (referenced.has(entry.name)) {
      stillUsed.push(entry.name);
      continue;
    }
    fs.mkdirSync(uploadsBackup, { recursive: true });
    const from = path.join(uploadsDir, entry.name);
    const to = path.join(uploadsBackup, entry.name);
    // Copy then delete rather than rename, so it also works across drives.
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
    moved.push(entry.name);
  }
  if (moved.length > 0) console.log(`${TAG} moved ${moved.length} unreferenced upload(s) to ${uploadsBackup}`);
}

// --- 5. Report. ---------------------------------------------------------------
console.log(`\n${TAG} ${"table".padEnd(22)} ${"before".padStart(7)} ${"removed".padStart(8)} ${"after".padStart(6)}`);
for (const name of reportTables) {
  const after = count(db, name);
  console.log(`${TAG} ${name.padEnd(22)} ${String(before[name]).padStart(7)} ${String(removed[name] ?? 0).padStart(8)} ${String(after).padStart(6)}`);
}

const admins = db.prepare("SELECT id, email, role FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id").all() as UserRow[];
console.log(`\n${TAG} admin/superadmin users now: ${admins.length}`);
for (const user of admins) console.log(`${TAG}   #${user.id} ${user.email} [${user.role}]`);
console.log(`${TAG} id counters reset for: ${clearTables.join(", ")}`);
console.log(`${TAG} uploads: ${moved.length} moved to backup, ${stillUsed.length} still referenced and left in place`);
console.log(`${TAG} done. Backup: ${backupPath}`);

db.close();
process.exit(0);
