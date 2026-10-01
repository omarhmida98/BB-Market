
import Database from "better-sqlite3";

const db = new Database("sred_showcase.db");
try {
    const result = db.prepare("UPDATE users SET role = 'superadmin'").run();
    console.log(`Successfully updated ${result.changes} users to superadmin.`);
} catch (err) {
    if (err.message.includes("no such column: role")) {
        console.log("Column 'role' does not exist yet. Please run 'npm run db:push' or refresh the database.");
    } else {
        console.error("Error updating users:", err.message);
    }
} finally {
    db.close();
}
