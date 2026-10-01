/**
 * Applies all pending Drizzle migrations to the configured database.
 *
 *   npm run db:migrate
 *
 * Works for both dialects; it picks the migration folder that matches the
 * current DATABASE_URL:
 *   - SQLite     -> server/migrations/sqlite
 *   - PostgreSQL -> server/migrations/pg
 *
 * Migrations are idempotent: drizzle-kit records a timestamp watermark in
 * __drizzle_migrations and only applies entries newer than the last applied one.
 */
import "../env.js";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { resolveDbTarget } from "../db-target.js";
import { readJournal } from "./journal.js";

const target = resolveDbTarget();
const journal = readJournal(target.migrationsFolder);

console.log(`[migrate] dialect   : ${target.dialect}`);
console.log(`[migrate] folder    : ${target.migrationsFolder}`);
console.log(`[migrate] available : ${journal.length} migration(s)`);

if (journal.length === 0) {
  console.log("[migrate] nothing to do.");
  process.exit(0);
}

if (target.dialect === "postgresql") {
  const pool = new pg.Pool({ connectionString: target.url, ssl: target.ssl });
  const db = drizzlePg(pool);
  const tls = pool.options.ssl ? "TLS on" : "TLS OFF (DATABASE_SSL=false)";
  console.log(`[migrate] applying to Postgres at ${target.url.replace(/:([^@]+)@/, ":****@")} (${tls})`);
  await migratePg(db, { migrationsFolder: target.migrationsFolder });
  await pool.end();
} else {
  const sqlite = new Database(target.sqlitePath!);
  const db = drizzleSqlite(sqlite);
  console.log(`[migrate] applying to ${target.sqlitePath}`);
  migrateSqlite(db, { migrationsFolder: target.migrationsFolder });
  sqlite.close();
}

const last = journal[journal.length - 1];
console.log(`[migrate] schema is now at: ${last.tag} (${last.when})`);
console.log("[migrate] done.");
