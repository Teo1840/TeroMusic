import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { currentUserId } from "../lib/auth";
import { errorMessage } from "../lib/format";
import { markRead } from "../lib/notifications";

const POLL_MS = 10000;
const PAGE_SIZE = 20;

/*
 * Historial de avisos del usuario, según notification_service:
 *   GET /notifications/user/{user_id}?limit&offset
 *     → [{ id, type, message, resource_id, created_at, read_at }]  del más nuevo al más viejo
 *   POST /notifications/user/{user_id}/read  → body { ids } (sin ids: todas) → { unread }
 * El gateway pone X-User-Id con el usuario del JWT: pedir los de otro da 403.
 * read_at null = sin leer. Abrir el link de un aviso también lo marca como leído.
 */

const KIND = {
    "user.registered.v1": "Bienvenida",
    "audio.ready.v1": "Canción lista",
    "audio.failed.v1": "Error al procesar",
    "room.created.v1": "Sala creada",
    "song.deleted.v1": "Canción borrada"
};

/** A dónde lleva cada aviso, si tiene algo para abrir. */
function linkFor(notification) {
    switch (notification.type) {
        case "audio.ready.v1":
        case "audio.failed.v1":
        case "song.deleted.v1":
            return { to: "/my-songs", label: "Ver mis canciones" };
        case "room.created.v1":
            return notification.resource_id ? { to: `/rooms/${notification.resource_id}`, label: "Entrar a la sala" } : null;
        default:
            return null;
    }
}

function formatWhen(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
        ? ""
        : date.toLocaleString("es", { dateStyle: "medium", timeStyle: "short" });
}

export default function Notifications() {

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [marking, setMarking] = useState(false);

    const userId = currentUserId();

    useEffect(() => {
        let alive = true;
        let timer = null;

        // Trae la primera página y la vuelve a pedir cada tanto: un aviso nuevo
        // (p. ej. "tu canción está lista") aparece sin recargar.
        async function loadFirstPage() {
            try {
                const { data } = await api.get(`/notifications/user/${userId}`, {
                    params: { limit: PAGE_SIZE, offset: 0 }
                });
                if (!alive) return;
                setItems((prev) => {
                    // Conserva las páginas viejas que ya se cargaron con "Ver más".
                    const fresh = new Set(data.map((n) => n.id));
                    return [...data, ...prev.slice(PAGE_SIZE).filter((n) => !fresh.has(n.id))];
                });
                setHasMore((prev) => prev || data.length === PAGE_SIZE);
                setError("");
            } catch (err) {
                if (alive) setError(errorMessage(err, "No se pudieron cargar tus notificaciones."));
            } finally {
                if (alive) {
                    setLoading(false);
                    timer = setTimeout(loadFirstPage, POLL_MS);
                }
            }
        }

        if (userId) {
            loadFirstPage();
        } else {
            setLoading(false);
        }
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [userId]);

    async function loadMore() {
        setLoadingMore(true);
        try {
            const { data } = await api.get(`/notifications/user/${userId}`, {
                params: { limit: PAGE_SIZE, offset: items.length }
            });
            const known = new Set(items.map((n) => n.id));
            setItems((prev) => [...prev, ...data.filter((n) => !known.has(n.id))]);
            setHasMore(data.length === PAGE_SIZE);
        } catch (err) {
            setError(errorMessage(err, "No se pudieron cargar más notificaciones."));
        } finally {
            setLoadingMore(false);
        }
    }

    const unreadCount = items.filter((n) => !n.read_at).length;

    /** Marca como leídos (ids, o todos) y actualiza la lista sin esperar al polling. */
    async function read(ids) {
        const now = new Date().toISOString();
        const target = ids ? new Set(ids) : null;
        setMarking(true);
        try {
            await markRead(ids);
            setItems((prev) => prev.map((n) => (!n.read_at && (!target || target.has(n.id)) ? { ...n, read_at: now } : n)));
            setError("");
        } catch (err) {
            setError(errorMessage(err, "No se pudieron marcar como leídas."));
        } finally {
            setMarking(false);
        }
    }

    return (
        <div className="page max-w-3xl">

            <div className="flex flex-wrap items-end justify-between gap-3">
                <h1 className="page-title">Notificaciones</h1>
                {unreadCount > 0 && (
                    <button type="button" className="btn py-1 text-sm" onClick={() => read()} disabled={marking}>
                        Marcar todas como leídas
                    </button>
                )}
            </div>
            <p className="muted mt-2 mb-6">
                Avisos de la plataforma: tu bienvenida, cuando una canción que subiste está lista
                (o no se pudo procesar) y las salas que creaste.
            </p>

            {loading && <p className="muted">Cargando notificaciones...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {!loading && !error && items.length === 0 && (
                <p className="muted">Todavía no tenés notificaciones.</p>
            )}

            {items.length > 0 && (
                <ul className="space-y-3">
                    {items.map((notification) => {
                        const link = linkFor(notification);
                        const unread = !notification.read_at;
                        return (
                            <li
                                key={notification.id}
                                className={`card ${unread ? "border-l-4" : "opacity-80"}`}
                                data-unread={unread || undefined}
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                                    <p className="text-sm font-semibold">
                                        {KIND[notification.type] ?? "Aviso"}
                                        {unread && (
                                            <span className="ml-2 inline-block bg-black text-white text-xs px-1.5 py-0.5 align-middle">
                                                Nuevo
                                            </span>
                                        )}
                                    </p>
                                    <time className="muted text-sm" dateTime={notification.created_at}>
                                        {formatWhen(notification.created_at)}
                                    </time>
                                </div>
                                <p className={`mt-1 break-words ${unread ? "font-medium" : ""}`}>{notification.message}</p>
                                {(link || unread) && (
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm">
                                        {link && (
                                            <Link
                                                to={link.to}
                                                className="underline"
                                                onClick={() => unread && read([notification.id]).catch(() => {})}
                                            >
                                                {link.label}
                                            </Link>
                                        )}
                                        {unread && (
                                            <button
                                                type="button"
                                                className="link"
                                                onClick={() => read([notification.id])}
                                                disabled={marking}
                                            >
                                                Marcar como leída
                                            </button>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {hasMore && (
                <button type="button" className="btn mt-6" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Cargando..." : "Ver más"}
                </button>
            )}

        </div>
    );
}
