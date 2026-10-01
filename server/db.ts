import "./env.js";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import pg from "pg";
import Database from "better-sqlite3";
import { pgSchema, sqliteSchema } from "shared/db-schema.js";
import { resolveDbTarget } from "./db-target.js";

const target = resolveDbTarget();

export let db: any;
export let schema: any;

/**
 * Read naive `timestamp` values from PostgreSQL as UTC.
 *
 * node-postgres parses OID 1114 (`timestamp without time zone`) by treating the
 * value as *local* time, so on a machine set to Europe/Paris the string
 * `2026-10-01 01:30:00` becomes an instant two hours early. That is the read-side
 * half of the same bug the pool's `timezone=UTC` fixes on the write side: with the
 * session pinned to UTC the stored naive values are UTC, and this parser makes the
 * JavaScript agree. Together they make timestamps absolute and correct regardless of
 * how the server, the database or the Node process is configured.
 *
 * `timestamptz` (OID 1184) is left alone: it already carries an offset.
 */
if (target.dialect === "postgresql") {
  pg.types.setTypeParser(1114, (value: string) => (value ? new Date(`${value}Z`) : null));
}

// Handles kept so `closeDatabase()` can release them. better-sqlite3 in particular
// keeps a lock on the file for the life of the process, which is what stops a
// test or a maintenance script from deleting or replacing the database file.
let sqliteHandle: Database.Database | null = null;
let pgPool: pg.Pool | null = null;

/**
 * Close the database connection.
 *
 * Used by scripts that need to delete or move the SQLite file (Windows refuses to
 * unlink an open file) and available for a graceful shutdown. Safe to call more
 * than once.
 */
export async function closeDatabase(): Promise<void> {
  if (pgPool) {
    const pool = pgPool;
    pgPool = null;
    await pool.end();
  }
  if (sqliteHandle) {
    const handle = sqliteHandle;
    sqliteHandle = null;
    handle.close();
  }
}

if (target.dialect === "postgresql") {
  console.log(`[DB] Connecting to Postgres at: ${target.url.replace(/:([^@]+)@/, ":****@")}`);

  // Every timestamp column in this schema is `timestamp without time zone`, but the
  // whole application reasons in UTC: analytics buckets orders with
  // `created_at AT TIME ZONE 'UTC'` and compares them against `...Z` literals.
  //
  // Those two only agree if the session timezone is UTC. `now()` returns a
  // `timestamptz`, and casting it into a naive column stores the *session's local
  // wall clock*. On a server with TimeZone=Europe/Paris an order placed at
  // 2026-09-30T23:30Z is stored as `2026-10-01 01:30`, which analytics then labels
  // `2026-10-01` - a day late - and the `created_at >= '...Z'` range boundary shifts
  // by the same offset. Revenue, order counts and AOV are all wrong near midnight,
  // and only on PostgreSQL; SQLite stores epoch values and never had the bug.
  //
  // `options: "-c timezone=UTC"` is sent on every connection the pool opens, so the
  // fix does not depend on how the server or database is configured, and survives a
  // DBA changing the default out from under the app.
  const pool = new pg.Pool({
    connectionString: target.url,
    // TLS policy is resolved centrally in db-target.ts so the runtime pool and
    // `npm run db:migrate` can never disagree about it.
    ssl: target.ssl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    options: "-c timezone=UTC",
  });
  pool.on("error", (err) => {
    console.error("[DB] Idle client error:", err.message);
  });
  db = drizzlePg(pool, { schema: pgSchema });
  schema = pgSchema;
  pgPool = pool;
} else {
  // Guard against the worst production failure mode: silently running against a
  // local SQLite file on the VPS while the operator believes PostgreSQL is live.
  // This would lose data on every restart and never surface as an error.
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_SQLITE_IN_PRODUCTION) {
    throw new Error(
      "Refusing to start in production with a SQLite database.\n" +
      "  Set DATABASE_URL to a PostgreSQL connection string, e.g.\n" +
      "    DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/bb_market\n" +
      "If you really intend SQLite in production, set ALLOW_SQLITE_IN_PRODUCTION=1.",
    );
  }
  console.log(`[DEBUG-DB] Database will be opened exactly at: ${target.sqlitePath}`);
  const sqlite = new Database(target.sqlitePath!);
  sqliteHandle = sqlite;

  // Foreign key enforcement.
  //
  // Migration 0004 makes `wishlist.product_id` an `ON DELETE CASCADE` reference,
  // and that cascade is the mechanism which keeps every customer's wishlist entry
  // from outliving the product it points at. Without enforcement the constraint
  // is still *parsed* but never *applied*, so deleting a product would leave
  // dangling rows and the wishlist page would have to guard against them in every
  // query - which is exactly the bug the reference exists to prevent.
  //
  // better-sqlite3 already turns this on for us, so this line is a no-op today and
  // is kept as an explicit statement of intent: the cascade's correctness depends
  // on it, and a future change to the driver (or a plain `sqlite3` connection in a
  // maintenance script) would otherwise silently disable it. SQLite's own default
  // is OFF, so relying on the driver's default would be relying on a detail.
  sqlite.pragma("foreign_keys = ON");

  // SCHEMA OWNERSHIP
  // ----------------
  // This file deliberately contains NO CREATE TABLE / CREATE INDEX / ALTER TABLE.
  // shared/db-schema.ts is the single source of truth, and the SQL in
  // server/migrations/<dialect> (generated by `npm run db:generate`) is what
  // creates or upgrades the schema. Apply pending migrations with `npm run db:migrate`.
  //
  // The check below only warns; it performs no DDL.
  const products = sqlite
    .prepare("select count(*) as c from sqlite_master where type='table' and name='products'")
    .get() as { c: number } | undefined;
  if (!products || products.c === 0) {
    console.warn(
      "\n[DB] WARNING: this SQLite database has no schema yet.\n" +
      "     Run `npm run db:migrate` once to create the full schema.\n",
    );
  }

  db = drizzleSqlite(sqlite, { schema: sqliteSchema });
  schema = sqliteSchema;
}

export const { products, messages, users, promos, stickerCatalogs, settings, userActivities, categories, orders, socialMediaEmbeds, wishlist } = schema;
