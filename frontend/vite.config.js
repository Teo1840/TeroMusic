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
                // El gateway limita pedidos por IP del navegador (X-Forwarded-For).
                // Se REEMPLAZA el header con la IP real de la conexión: con "xfwd: true"
                // se agregaba al final del que mandó el cliente, y el cliente podía poner
                // una IP inventada distinta en cada pedido para saltear el límite de login.
                configure: (proxy) => {
                    const setClientIp = (proxyReq, req) =>
                        proxyReq.setHeader("X-Forwarded-For", req.socket.remoteAddress || "");
                    proxy.on("proxyReq", setClientIp);
                    proxy.on("proxyReqWs", setClientIp);
                },
                // Deja pasar los WebSockets de las salas en vivo (/api/v1/ws/rooms/...).
                ws: true
            }
        }
    }
});