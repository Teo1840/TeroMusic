import api from "../api/client";
import { msUntilExpiry, saveToken } from "./auth";

/*
 * Renovación de la sesión. El JWT dura 60 minutos: cuando le quedan menos de
 * REFRESH_BEFORE_MS se cambia por uno nuevo (POST /auth/refresh), así no te saca
 * en medio de una sala o de una subida. user_service corta igual a los 7 días
 * del login (SESSION_MAX_HOURS) o si cambiaste la contraseña en otro lado.
 */

export const REFRESH_BEFORE_MS = 10 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

let inFlight = null;

/** Pide un token nuevo si al actual le queda poco. Devuelve true si lo renovó. */
export async function refreshIfNeeded(threshold = REFRESH_BEFORE_MS) {
    const left = msUntilExpiry();
    // Sin token o ya vencido: no hay nada que renovar (ProtectedRoute manda al login).
    if (left === null || left <= 0 || left > threshold) return false;
    if (!inFlight) {
        inFlight = api.post("/auth/refresh")
            .then(({ data }) => {
                saveToken(data.access_token);
                return true;
            })
            // Si falla (red caída, sesión revocada) se reintenta en la próxima vuelta;
            // si el token llega a vencer, el próximo pedido da 401 y va al login.
            .catch(() => false)
            .finally(() => { inFlight = null; });
    }
    return inFlight;
}

/** Revisa cada minuto y al volver a la pestaña (los timers se frenan en segundo plano). */
export function startSessionRefresh() {
    const check = () => { refreshIfNeeded(); };
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    check();
    return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("focus", check);
    };
}
