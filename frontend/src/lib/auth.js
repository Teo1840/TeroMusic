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

/** Rol del usuario logueado ("user" o "admin"), o null si no hay sesión. Solo para mostrar
 *  u ocultar cosas: lo que se permite lo decide el backend con el rol de la base. */
export function currentRole() {
    const token = getToken();
    return (token && tokenPayload(token)?.role) || null;
}

/** Milisegundos hasta que vence el token (negativo si ya venció), o null si no hay. */
export function msUntilExpiry() {
    const token = getToken();
    const exp = token && tokenPayload(token)?.exp;
    return exp ? exp * 1000 - Date.now() : null;
}
