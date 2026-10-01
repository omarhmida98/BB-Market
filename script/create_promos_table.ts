
import Database from 'better-sqlite3';
import 'dotenv/config';

const dbPath = process.env.DATABASE_URL || '';
if (!dbPath) {
    console.error("DATABASE_URL not set");
    process.exit(1);
}

if (dbPath.startsWith('file:') || dbPath.match(/^\//)) {
    const sqlitePath = dbPath.replace('file:', '');
    const db = new Database(sqlitePath);

    try {
        console.log("Checking for 'promos' table...");
        const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='promos'").get();

        if (tableInfo) {
            console.log("Table 'promos' already exists.");
        } else {
            console.log("Creating 'promos' table...");
            db.prepare(`
                CREATE TABLE IF NOT EXISTS "promos" (
                    "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    "image_url" text NOT NULL,
                    "created_at" integer DEFAULT (strftime('%s','now'))
                )
            `).run();
            console.log("Success!");
        }
    } catch (error) {
        console.error("Error updating database:", error);
    } finally {
        db.close();
    }
} else {
    console.log('DATABASE_URL is not a sqlite file; skipping sqlite promos migration. Use SQL migrations for Postgres instead.');
}
}
