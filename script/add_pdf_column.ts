import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "sred_showcase.db");
const db = new Database(dbPath);

console.log("Checking for 'stickers_pdf_url' column in 'settings' table...");

try {
    const tableInfo = db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
    const columnExists = tableInfo.some((col) => col.name === "stickers_pdf_url");

    if (!columnExists) {
        console.log("Adding 'stickers_pdf_url' column...");
        db.prepare("ALTER TABLE settings ADD COLUMN stickers_pdf_url TEXT").run();
        console.log("Column added successfully!");
    } else {
        console.log("Column 'stickers_pdf_url' already exists.");
    }
} catch (error) {
    console.error("Error updating database:", error);
} finally {
    db.close();
}
