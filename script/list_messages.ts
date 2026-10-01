
import 'dotenv/config';
import { db } from "../server/db";
import { messages } from "@shared/schema";
import { desc } from "drizzle-orm";

async function listMessages() {
    console.log("Fetching messages...\n");

    try {
        const allMessages = await db.select().from(messages).orderBy(desc(messages.createdAt));

        if (allMessages.length === 0) {
            console.log("No messages found.");
        } else {
            console.log(`Found ${allMessages.length} message(s):\n`);
            allMessages.forEach((msg) => {
                console.log(`----------------------------------------`);
                console.log(`ID: ${msg.id}`);
                console.log(`From: ${msg.name} (${msg.phone})`);
                console.log(`Date: ${msg.createdAt}`);
                console.log(`Message: ${msg.message}`);
                console.log(`----------------------------------------\n`);
            });
        }
        process.exit(0);
    } catch (error) {
        console.error("Error fetching messages:", error);
        process.exit(1);
    }
}

listMessages();
