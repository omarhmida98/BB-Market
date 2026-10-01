/**
 * Sets (or revokes) a user's password directly in the database.
 *
 *   npm run set-password -- <email>              # generates a strong password
 *   npm run set-password -- <email> <password>   # sets a specific password
 *   npm run set-password -- <email> --revoke     # makes the account password-less
 *
 * A generated password is written to a file under the OS temp dir and the path is
 * printed, so the secret never lands in logs or source. Any pending reset token is
 * always cleared, so a forced reset invalidates old reset links.
 */
import "../env.js";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import { resolveDbTarget } from "../db-target.js";
import { hashPassword } from "../auth.js";

const args = process.argv.slice(2);
const email = args[0];
if (!email) {
  console.error("Usage: npm run set-password -- <email> [password|--revoke]");
  process.exit(1);
}
const revoke = args.includes("--revoke");
const explicit = args[1] && !args[1].startsWith("--") ? args[1] : undefined;

/** 24 chars from a 62-symbol alphabet: ~143 bits of entropy. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(32);
  let out = "";
  for (let i = 0; i < 24; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const password = revoke ? null : (explicit ?? generatePassword());
const stored = password === null ? null : await hashPassword(password);

const target = resolveDbTarget();
let userId: number | null = null;

if (target.dialect === "postgresql") {
  const pool = new pg.Pool({ connectionString: target.url, ssl: target.ssl });
  const db = drizzlePg(pool);
  const res = await db.execute(
    `UPDATE users SET password = ${stored === null ? "NULL" : stored}, reset_token = NULL, reset_token_expires = NULL
     WHERE email = ${email} RETURNING id`,
  );
  const rows = (res as any).rows ?? res;
  userId = rows?.[0]?.id ?? null;
  await pool.end();
} else {
  const sqlite = new Database(target.sqlitePath!);
  const row = sqlite.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number } | undefined;
  if (row) {
    userId = row.id;
    sqlite
      .prepare(`UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?`)
      .run(stored, row.id);
  }
  sqlite.close();
}

if (userId === null) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

console.log(`[set-password] updated user id ${userId} (${email})`);
console.log(`[set-password] reset tokens cleared`);

if (password !== null) {
  const outPath = path.join(os.tmpdir(), `bb-password-${email.replace(/[^a-z0-9]/gi, "_")}.txt`);
  fs.writeFileSync(outPath, password, { encoding: "utf8", mode: 0o600 });
  console.log(`[set-password] new password written to: ${outPath}`);
  console.log(`[set-password] read it with:  Get-Content "${outPath}"`);
}
console.log("[set-password] done.");
