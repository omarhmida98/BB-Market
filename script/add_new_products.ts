
import 'dotenv/config'; // Ensure env vars are loaded
import { storage } from "../server/storage";

async function addNewProducts() {
    console.log("Adding new products...");

    const newProducts = [
        {
            name: "Produit 4",
            description: "Description pour le produit 4 - Un ajout élégant à votre collection.",
            imageUrl: "/attached_assets/4.jpg",
            category: "Nouveautés"
        },
        {
            name: "Produit 5",
            description: "Description pour le produit 5 - Qualité et design exceptionnels.",
            imageUrl: "/attached_assets/5.jpg",
            category: "Nouveautés"
        },
        {
            name: "Produit 6",
            description: "Description pour le produit 6 - Idéal pour vos événements spéciaux.",
            imageUrl: "/attached_assets/6.jpg",
            category: "Nouveautés"
        },
        {
            name: "Produit 7",
            description: "Description pour le produit 7 - Une touche de sophistication.",
            imageUrl: "/attached_assets/7.jpg",
            category: "Nouveautés"
        },
        {
            name: "Produit 8",
            description: "Description pour le produit 8 - Conçu pour impressionner.",
            imageUrl: "/attached_assets/8.jpg",
            category: "Nouveautés"
        },
        {
            name: "Produit 9",
            description: "Description pour le produit 9 - L'excellence en matière d'emballage.",
            imageUrl: "/attached_assets/9.jpg",
            category: "Nouveautés"
        }
    ];

    try {
        for (const product of newProducts) {
            await storage.createProduct(product);
            console.log(`Added: ${product.name}`);
        }
        console.log("All new products added successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Error adding products:", error);
        process.exit(1);
    }
}

addNewProducts();
