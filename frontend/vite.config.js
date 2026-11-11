import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
        react(),
        tailwindcss()
    ],
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/api": {
                target: "http://gateway:80",
                changeOrigin: true,
                // Manda X-Forwarded-For: el gateway limita pedidos por IP del navegador.
                xfwd: true,
                // Deja pasar los WebSockets de las salas en vivo (/api/v1/ws/rooms/...).
                ws: true
            }
        }
    }
});