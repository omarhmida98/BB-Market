/**
 * ONE-TIME baseline for databases that predate the migrations folder.
 *
 *   npm run db:baseline
 *
 * Existing installs were built by hand-written CREATE TABLE statements in
 * server/db.ts, so they already contain the full schema but have no
 * __drizzle_migrations table. Running `db:migrate` on them would try to re-run
 * 0000_initial_schema and fail with "table already exists".
 *
 * Drizzle decides what to run by comparing the last applied `created_at`
 * watermark against each migration's journal timestamp. So baselining simply
 * writes that watermark for the newest migration already reflected in the
 * database. Nothing is created, dropped, or altered.
 *
 * Safety: refuses to run if the database has no schema (a fresh database should
 * use `db:migrate`, which builds it correctly from scratch).
 */
import "../env.js";
import Database from "better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import { resolveDbTarget } from "../db-target.js";
import { readJournal } from "./journal.js";

const target = resolveDbTarget();
const journal = readJournal(target.migrationsFolder);
if (journal.length === 0) throw new Error("No migrations to baseline against.");
const latest = journal[journal.length - 1];

if (process.argv.includes("--help")) {
  console.log("Usage: npm run db:baseline");
  process.exit(0);
}

console.log(`[baseline] dialect : ${target.dialect}`);
console.log(`[baseline] target  : ${target.dialect === "postgresql" ? target.url.replace(/:([^@]+)@/, ":****@") : target.sqlitePath}`);
console.log(`[baseline] marking : ${latest.tag} (${latest.when}) as already applied`);

if (target.dialect === "postgresql") {
  const pool = new pg.Pool({ connectionString: target.url, ssl: target.ssl });
  const client = await pool.connect();
  try {
    const probe = await client.query(
      `select count(*)::int as c from information_schema.tables where table_name = 'products'`,
    );
    if (!probe.rows[0]?.c) {
      throw new Error(
        "This PostgreSQL database has no `products` table.\n" +
        "It looks like a fresh database: use `npm run db:migrate` instead of baselining.",
      );
    }
    await client.query(
      `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at numeric
       )`,
    );
    const existing = await client.query(
      `SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
    );
    if (existing.rows[0] && Number(existing.rows[0].created_at) >= latest.when) {
      console.log("[baseline] already baselined (watermark is current). Nothing to do.");
    } else {
      await client.query(
        `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [`baseline_${latest.tag}`, latest.when],
      );
      console.log("[baseline] watermark written. No schema changes were made.");
    }
  } finally {
    client.release();
    await pool.end();
  }
} else {
  const sqlite = new Database(target.sqlitePath!);
  try {
    const probe = sqlite
      .prepare("select count(*) as c from sqlite_master where type='table' and name='products'")
      .get() as { c: number } | undefined;
    if (!probe || probe.c === 0) {
      throw new Error(
        "This SQLite database has no `products` table.\n" +
        "It looks like a fresh database: use `npm run db:migrate` instead of baselining.",
      );
    }
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at numeric
       )`,
    );
    const row = sqlite
      .prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
      .get() as { created_at: number } | undefined;
    if (row && Number(row.created_at) >= latest.when) {
      console.log("[baseline] already baselined (watermark is current). Nothing to do.");
    } else {
      sqlite
        .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
        .run(`baseline_${latest.tag}`, latest.when);
      console.log("[baseline] watermark written. No schema changes were made.");
    }
  } finally {
    sqlite.close();
  }
}
