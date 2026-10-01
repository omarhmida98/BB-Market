
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
        // Check if phone column exists
        const tableInfo = db.prepare("PRAGMA table_info(messages)").all();
        const hasPhone = tableInfo.some((col: any) => col.name === 'phone');
        const hasEmail = tableInfo.some((col: any) => col.name === 'email');

        if (hasPhone) {
            console.log("Column 'phone' already exists.");
        } else if (hasEmail) {
            console.log("Renaming 'email' to 'phone'...");
            db.prepare("ALTER TABLE messages RENAME COLUMN email TO phone").run();
            console.log("Success!");
        } else {
            console.log("Neither 'phone' nor 'email' column found. Adding 'phone'...");
            db.prepare("ALTER TABLE messages ADD COLUMN phone TEXT NOT NULL DEFAULT ''").run();
            console.log("Success!");
        }
    } catch (error) {
        console.error("Error updating schema:", error);
    } finally {
        db.close();
    }
} else {
    console.log('DATABASE_URL is not a sqlite file; fix_db script skipped. Use SQL migrations for Postgres.');
}
}
