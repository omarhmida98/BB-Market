
import Database from "better-sqlite3";

const db = new Database("sred_showcase.db");
try {
    // Set all users to admin first
    db.prepare("UPDATE users SET role = 'admin'").run();

    // Set 'mohamed' to superadmin (case-insensitive check just in case)
    const result = db.prepare("UPDATE users SET role = 'superadmin' WHERE LOWER(username) = 'mohamed'").run();

    if (result.changes > 0) {
        console.log(`Successfully set 'mohamed' as Super Admin. Total changes: ${result.changes}`);
    } else {
        console.log("Warning: User 'mohamed' not found. Please check the username.");
        // List users to help identify the correct one
        const users = db.prepare("SELECT username FROM users").all();
        console.log("Existing users:", users.map(u => u.username).join(", "));
    }
} catch (err) {
    console.error("Error updating users:", err.message);
} finally {
    db.close();
}
