/**
 * Sesión del usuario: el JWT que devuelve user_service se guarda en localStorage
 * y se manda en cada pedido (ver api/client.js).
 */

const TOKEN_KEY = "access_token";

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

/** Datos del JWT (sub, email, role, exp). El JWT usa base64url: se pasa a base64 para atob. */
function tokenPayload(token) {
    try {
        const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(part));
    } catch {
        return null;
    }
}

/** Id del usuario logueado (el "sub" del JWT), o null si no hay sesión. */
export function currentUserId() {
    const token = getToken();
    return (token && tokenPayload(token)?.sub) || null;
}

/** Hay un token y no venció. La firma la verifica el gateway, no el navegador. */
export function hasValidToken() {
    const token = getToken();
    const payload = token && tokenPayload(token);
    return Boolean(payload?.exp) && payload.exp * 1000 > Date.now();
}
