import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    envDir: "../",
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.png', 'favicon-192x192.png', 'favicon-32x32.png', 'favicon-maskable-512.png'],
            manifest: {
                name: 'B&B Market',
                short_name: 'B&B Market',
                description: 'Vitrine en ligne des emballages et décors Raies',
                theme_color: '#0055ff',
                background_color: '#ffffff',
                display: 'standalone',
                scope: '/',
                start_url: '/',
                icons: [
                    {
                        src: 'favicon-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'favicon.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'favicon-maskable-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            }
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
            "@shared": path.resolve(__dirname, "../shared"),
            "@assets": path.resolve(__dirname, "../attached_assets"),
        },
    },
    server: {
proxy: {
            "/api": "http://localhost:5000",
            "/auth": "http://localhost:5000",
            "/attached_assets": "http://localhost:5000",
            "/uploads": "http://localhost:5000",
        },
    },
    build: {
        outDir: "../dist/public",
        emptyOutDir: true,
    },
});
