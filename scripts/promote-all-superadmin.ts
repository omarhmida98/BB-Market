
import { db } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function promote() {
    console.log("Promoting all existing users to superadmin for initial setup...");
    const result = await db.update(users).set({ role: "superadmin" }).returning();
    console.log(`Updated ${result.length} users.`);
    result.forEach(u => console.log(`- ${u.username} is now ${u.role}`));
}

promote().catch(console.error);
