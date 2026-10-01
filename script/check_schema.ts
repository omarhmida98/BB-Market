
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
    import fs from 'fs';
    const tableInfo = db.prepare("PRAGMA table_info(messages)").all();
    fs.writeFileSync('schema_output.json', JSON.stringify(tableInfo, null, 2));
    db.close();
} else {
    console.log('DATABASE_URL is not a sqlite file; schema inspection is skipped.');
}
