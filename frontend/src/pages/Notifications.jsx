import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { currentUserId } from "../lib/auth";
import { errorMessage } from "../lib/format";

const POLL_MS = 10000;
const PAGE_SIZE = 20;

/*
 * Historial de avisos del usuario, según notification_service:
 *   GET /notifications/user/{user_id}?limit&offset
 *     → [{ id, type, message, resource_id, created_at }]  del más nuevo al más viejo
 * El gateway pone X-User-Id con el usuario del JWT: pedir los de otro da 403.
 */

const KIND = {
    "user.registered.v1": "Bienvenida",
    "audio.ready.v1": "Canción lista",
    "audio.failed.v1": "Error al procesar",
    "room.created.v1": "Sala creada"
};

/** A dónde lleva cada aviso, si tiene algo para abrir. */
function linkFor(notification) {
    switch (notification.type) {
        case "audio.ready.v1":
        case "audio.failed.v1":
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

    return (
        <div className="page max-w-3xl">

            <h1 className="page-title">Notificaciones</h1>
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
                        return (
                            <li key={notification.id} className="card">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                                    <p className="text-sm font-semibold">{KIND[notification.type] ?? "Aviso"}</p>
                                    <time className="muted text-sm" dateTime={notification.created_at}>
                                        {formatWhen(notification.created_at)}
                                    </time>
                                </div>
                                <p className="mt-1 break-words">{notification.message}</p>
                                {link && (
                                    <Link to={link.to} className="inline-block mt-2 text-sm underline">
                                        {link.label}
                                    </Link>
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
