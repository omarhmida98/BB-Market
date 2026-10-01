import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the server package root regardless of how the code is executed.
 *
 * `__dirname` differs between environments:
 *   - dev  (tsx index.ts)        -> <repo>/server
 *   - prod (node dist/server/..) -> <repo>/server/dist/server
 *
 * Resolving the SQLite file against `__dirname` would therefore open a brand-new
 * empty database in production. Walk upwards to the directory that owns
 * package.json, skipping any `dist` folder, so dev and prod share one file.
 */
export function findServerPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    if (path.basename(dir) !== "dist" && fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export type DbTarget = {
  dialect: "sqlite" | "postgresql";
  /** The raw DATABASE_URL value (or the built-in SQLite default). */
  url: string;
  /** Absolute path to the SQLite file. Undefined for PostgreSQL. */
  sqlitePath?: string;
  /** Absolute path to the migration folder that matches the dialect. */
  migrationsFolder: string;
  /**
   * TLS settings for the PostgreSQL pool. Undefined for SQLite, which has no TLS.
   *
   * Resolved here rather than at each call site because the runtime pool and
   * `npm run db:migrate` must agree: a migrator that connects without TLS when the
   * app connects with it either fails against a `hostssl`-only rule or applies
   * production DDL over an unencrypted link.
   */
  ssl?: false | { rejectUnauthorized: boolean };
};

/**
 * TLS policy for every PostgreSQL connection.
 *
 * OVH's managed PostgreSQL offers both secure and non-secure access, so default to
 * requiring TLS to keep credentials and traffic off the wire in the clear. Operators
 * can opt out with `DATABASE_SSL=false` for a localhost socket or private network.
 * `rejectUnauthorized: false` accepts OVH's certificate, which is issued for the
 * managed-service hostname rather than the connection endpoint.
 */
export function resolvePgSsl(env: NodeJS.ProcessEnv = process.env): false | { rejectUnauthorized: boolean } {
  return env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
}

/**
 * Single source of truth for "which database are we talking to?".
 *
 * Used by server/db.ts at runtime, by `npm run db:migrate`, and by the one-time
 * baseline tool, so those three can never disagree about the target file.
 */
export function resolveDbTarget(env: NodeJS.ProcessEnv = process.env): DbTarget {
  const url = env.DATABASE_URL || "file:./bb_market.db";
  const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");
  const serverRoot = findServerPackageRoot(__dirname);

  if (isPostgres) {
    return {
      dialect: "postgresql",
      url,
      migrationsFolder: path.resolve(serverRoot, "migrations/pg"),
      ssl: resolvePgSsl(env),
    };
  }

  const dbPath = url.startsWith("file:") ? url.slice(5) : url;
  return {
    dialect: "sqlite",
    url,
    sqlitePath: path.isAbsolute(dbPath) ? dbPath : path.resolve(serverRoot, dbPath),
    migrationsFolder: path.resolve(serverRoot, "migrations/sqlite"),
  };
}
