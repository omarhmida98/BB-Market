
import 'dotenv/config';
import { db } from "../server/db";
import { products } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

async function deleteNewProducts() {
    console.log("Deleting new products...");

    try {
        // We added products with names "Produit 4" to "Produit 9"
        const namesToDelete = [
            "Produit 4", "Produit 5", "Produit 6",
            "Produit 7", "Produit 8", "Produit 9"
        ];

        await db.delete(products).where(inArray(products.name, namesToDelete));

        console.log("Deleted any matching products.");
        process.exit(0);
    } catch (error) {
        console.error("Error deleting products:", error);
        process.exit(1);
    }
}

deleteNewProducts();
