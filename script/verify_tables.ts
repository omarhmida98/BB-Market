import Database from 'better-sqlite3';
import 'dotenv/config';

const dbPath = process.env.DATABASE_URL?.replace('file:', '');
console.log('Using DB Path:', dbPath);

if (dbPath) {
    const db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    console.log('--- ALL TABLES ---');
    tables.forEach(t => console.log(t.name));
    console.log('------------------');

    const hasStickers = tables.some(t => t.name === 'sticker_catalogs');
    console.log('Table "sticker_catalogs" exists:', hasStickers);
    db.close();
}
