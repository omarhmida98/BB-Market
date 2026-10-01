import "./env.js";
import Database from "better-sqlite3";
import path from "path";

console.log("CWD:", process.cwd());
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const dbUrl = process.env.DATABASE_URL || "file:./sred_showcase.db";
const dbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;

console.log("dbPath resolved to:", dbPath);
console.log("Absolute dbPath:", path.resolve(process.cwd(), dbPath));

const sqlite = new Database(dbPath);
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("Tables in database:", tables);
