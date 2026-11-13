import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RoomProvider } from "./lib/roomSession";
import { startSessionRefresh } from "./lib/session";

import "./index.css";

// Renueva el token antes de que venza mientras la app está abierta.
startSessionRefresh();

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            {/* Fuera de las rutas: la sala en vivo sigue sonando al cambiar de página. */}
            <RoomProvider>
                <App />
            </RoomProvider>
        </BrowserRouter>
    </React.StrictMode>
);