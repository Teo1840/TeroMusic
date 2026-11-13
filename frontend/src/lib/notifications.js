import api from "../api/client";
import { currentUserId } from "./auth";

/*
 * notification_service:
 *   GET  /notifications/user/{id}/unread-count  → { unread }
 *   POST /notifications/user/{id}/read          → body { ids } (sin ids: todas) → { unread }
 * Cuando la página de avisos marca algo como leído avisa con UNREAD_EVENT
 * (detail = cuántos quedan), así el contador del menú cambia al instante.
 */
export const UNREAD_EVENT = "teromusic:unread";

export async function fetchUnread() {
    const userId = currentUserId();
    if (!userId) return 0;
    const { data } = await api.get(`/notifications/user/${userId}/unread-count`);
    return data.unread;
}

/** ids: los avisos a marcar; sin ids, todos. Devuelve cuántos quedan sin leer. */
export async function markRead(ids) {
    const userId = currentUserId();
    const { data } = await api.post(`/notifications/user/${userId}/read`, ids ? { ids } : {});
    window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: data.unread }));
    return data.unread;
}

/** "9+" a partir de 10, para que el globito no crezca. */
export function badgeText(count) {
    return count > 9 ? "9+" : String(count);
}
