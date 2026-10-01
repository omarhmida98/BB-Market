import "./env.js";
import Database from "better-sqlite3";
import { resolveDbTarget } from "./db-target.js";
import { DEBUG_DB } from "./debug.js";

if (!DEBUG_DB) {
  console.log("[test] DEBUG_DB is off. Set DEBUG_DB=true to print database diagnostics.");
  process.exit(0);
}

const target = resolveDbTarget();
console.log("[test] dialect:", target.dialect);

if (target.dialect !== "sqlite" || !target.sqlitePath) {
  console.log("[test] Not a local SQLite database; nothing to inspect.");
  process.exit(0);
}

const sqlite = new Database(target.sqlitePath, { readonly: true });
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("[test] Tables:", tables);
sqlite.close();