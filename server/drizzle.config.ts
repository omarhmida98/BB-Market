import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../.env"), override: true });

const rawUrl = process.env.DATABASE_URL;
const isPostgres = !!rawUrl && (rawUrl.startsWith("postgres://") || rawUrl.startsWith("postgresql://"));

// Without DATABASE_URL, target the exact file the server opens at runtime
// (server/db.ts resolves the same name against this directory). Resolved to an
// absolute path so tooling can never silently target a different file.
const defaultSqlitePath = path.resolve(__dirname, "bb_market.db");
const sqlitePath = rawUrl
    ? (rawUrl.startsWith("file:") ? rawUrl.slice(5) : rawUrl)
    : defaultSqlitePath;

/**
 * SQLite migration config (local development).
 *
 * PostgreSQL production migrations live in ./migrations/pg and are generated with
 * drizzle.pg.config.ts, so each dialect has its own SQL. Both are generated from
 * the same shared/db-schema.ts, which keeps the two logically identical.
 */
export default defineConfig({
    out: "./migrations/sqlite",
    schema: "../shared/db-schema.ts",
    dialect: "sqlite",
    dbCredentials: {
        url: isPostgres ? rawUrl! : sqlitePath,
    },
});
