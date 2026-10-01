import { resolveDbTarget, findServerPackageRoot } from "./db-target.js";
import path from "path";

const rows: string[] = [];
function Check(name: string, cond: boolean, detail: string) {
  rows.push(`  ${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

const base = { PATH: process.env.PATH, NODE_ENV: "production" };

// 1. A PostgreSQL URL must select the postgresql dialect and the pg migrations.
const pg = resolveDbTarget({
  ...base,
  DATABASE_URL: "postgresql://bbmarket:pw@127.0.0.1:5432/bb_market",
} as NodeJS.ProcessEnv);
Check("pg url -> dialect", pg.dialect === "postgresql", `got=${pg.dialect}`);
Check("pg url -> no sqlite path", pg.sqlitePath === undefined, `sqlitePath=${String(pg.sqlitePath)}`);
Check("pg url -> pg migrations", pg.migrationsFolder.endsWith(path.join("migrations", "pg")), pg.migrationsFolder);

// 2. postgresql:// prefix works too.
const pg2 = resolveDbTarget({ ...base, DATABASE_URL: "postgresql://u:p@h:5432/d" } as NodeJS.ProcessEnv);
Check("postgresql:// prefix", pg2.dialect === "postgresql", `got=${pg2.dialect}`);

// 3. SQLite stays local-only, and never resolves a migrations/pg folder.
const lite = resolveDbTarget({ ...base, DATABASE_URL: "file:./bb_market.db" } as NodeJS.ProcessEnv);
Check("file: -> sqlite", lite.dialect === "sqlite", `got=${lite.dialect}`);
Check("sqlite -> sqlite migrations", lite.migrationsFolder.endsWith(path.join("migrations", "sqlite")), lite.migrationsFolder);
Check("sqlite -> absolute path", !!lite.sqlitePath && path.isAbsolute(lite.sqlitePath), `path=${lite.sqlitePath}`);

// 4. Unset DATABASE_URL must NOT silently become a production-ready DB.
const none = resolveDbTarget({ ...base } as NodeJS.ProcessEnv);
Check("unset -> sqlite default", none.dialect === "sqlite", `got=${none.dialect} (guarded at boot by db.ts)`);

// 5. Server package root resolution must skip dist/ in production.
const root = findServerPackageRoot(path.resolve(process.cwd(), "dist", "server"));
Check("findServerPackageRoot skips dist", path.basename(root) === "server" && !path.basename(root).includes("dist"), `root=${root}`);

console.log(rows.join("\n"));
process.exit(rows.some((r) => r.includes("FAIL")) ? 1 : 0);
