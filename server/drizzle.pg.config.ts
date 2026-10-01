import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../.env.prod"), override: false });
config({ path: path.resolve(__dirname, "../.env"), override: false });

const url = process.env.DATABASE_URL;

if (!url) {
    throw new Error(
        "DATABASE_URL is required to generate PostgreSQL migrations.\n" +
        "Set it in server/.env.prod (or the environment) before running db:generate:pg.",
    );
}

if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
    throw new Error(
        `DATABASE_URL must be a PostgreSQL URL for this config, got: ${url.slice(0, 12)}...`,
    );
}

/**
 * PostgreSQL migration config (production).
 *
 * Generated from the same shared/db-schema.ts as the SQLite config, so both
 * dialects describe the same logical schema. Nothing is deployed by this config;
 * it only writes SQL files into ./migrations/pg.
 */
export default defineConfig({
    out: "./migrations/pg",
    schema: "../shared/db-schema.ts",
    dialect: "postgresql",
    dbCredentials: { url },
});
