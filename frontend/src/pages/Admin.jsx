import { useEffect, useState } from "react";
import api from "../api/client";
import { currentUserId } from "../lib/auth";
import { errorMessage, formatTime } from "../lib/format";

/*
 * Administración (solo rol "admin"; el resto recibe 403 de los servicios):
 *
 *   GET   /auth/admin/users?q=          → cuentas con su rol (user_service)
 *   PATCH /auth/admin/users/{id}/role   → { role: "user" | "admin" }. 409 si es el último admin
 *   GET   /catalog/songs?q=             → canciones publicadas (para buscar)
 *   DELETE /catalog/songs/{id}          → un admin puede borrar canciones de cualquiera
 *
 * El rol se lee de la base en cada pedido: el cambio vale al instante.
 */
const ROLE_LABEL = { user: "Usuario", admin: "Admin" };
const SEARCH_DELAY_MS = 300;

/** Valor que cambia recién cuando se deja de escribir un rato. */
function useDebounced(value, delay = SEARCH_DELAY_MS) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

function Users() {
    const [query, setQuery] = useState("");
    const search = useDebounced(query.trim());
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busyId, setBusyId] = useState(null);
    const me = currentUserId();

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get("/auth/admin/users", { params: { q: search || undefined, limit: 100 } })
            .then(({ data }) => {
                if (cancelled) return;
                setUsers(data);
                setError("");
            })
            .catch((err) => {
                if (!cancelled) setError(errorMessage(err, "No se pudieron cargar las cuentas."));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [search]);

    async function setRole(user, role) {
        setBusyId(user.id);
        setNotice("");
        try {
            const { data } = await api.patch(`/auth/admin/users/${user.id}/role`, { role });
            setUsers((prev) => prev.map((u) => (u.id === data.id ? data : u)));
            setNotice(`${data.display_name || data.email} ahora es ${ROLE_LABEL[data.role].toLowerCase()}.`);
        } catch (err) {
            setNotice(err?.response?.status === 409
                ? "Tiene que quedar al menos un administrador."
                : errorMessage(err, "No se pudo cambiar el rol."));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <section aria-labelledby="admin-users" className="mb-10">
            <h2 id="admin-users" className="text-lg font-semibold mb-3">Cuentas</h2>

            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por email o nombre de artista..."
                aria-label="Buscar cuentas"
                className="field mb-4"
            />

            {error && <p className="notice mb-4" role="alert">{error}</p>}
            {notice && <p className="notice mb-4" role="status">{notice}</p>}
            {loading && <p className="muted">Cargando cuentas...</p>}
            {!loading && !error && users.length === 0 && <p className="muted">No hay cuentas que coincidan.</p>}

            <ul className="space-y-2">
                {users.map((user) => {
                    const isAdmin = user.role === "admin";
                    const busy = busyId === user.id;
                    return (
                        <li key={user.id} className="card min-w-0 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="font-semibold break-words">
                                    {user.display_name || user.email}
                                    {user.id === me && <span className="muted text-sm"> (vos)</span>}
                                </p>
                                <p className="muted text-sm break-words">
                                    {user.email} · {ROLE_LABEL[user.role] ?? user.role}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setRole(user, isAdmin ? "user" : "admin")}
                                disabled={busy}
                                className="btn py-1 text-sm"
                            >
                                {busy ? "Guardando..." : isAdmin ? "Quitar admin" : "Hacer admin"}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function Songs() {
    const [query, setQuery] = useState("");
    const search = useDebounced(query.trim());
    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [confirmId, setConfirmId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get("/catalog/songs", { params: { q: search || undefined, sort: "newest", limit: 50 } })
            .then(({ data }) => {
                if (cancelled) return;
                setSongs(data);
                setError("");
            })
            .catch((err) => {
                if (!cancelled) setError(errorMessage(err, "No se pudieron cargar las canciones."));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [search]);

    async function deleteSong(song) {
        setDeletingId(song.id);
        setNotice("");
        try {
            await api.delete(`/catalog/songs/${song.id}`);
            setSongs((prev) => prev.filter((s) => s.id !== song.id));
            setNotice(`"${song.title}" se borró.`);
        } catch (err) {
            if (err?.response?.status === 404) {
                setSongs((prev) => prev.filter((s) => s.id !== song.id));
                setNotice(`"${song.title}" ya no existía.`);
            } else {
                setNotice(errorMessage(err, "No se pudo borrar la canción."));
            }
        } finally {
            setDeletingId(null);
            setConfirmId(null);
        }
    }

    return (
        <section aria-labelledby="admin-songs">
            <h2 id="admin-songs" className="text-lg font-semibold mb-1">Canciones</h2>
            <p className="muted text-sm mb-3">
                Borrar una canción la saca del catálogo, de las playlists y de las salas abiertas.
            </p>

            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por título o artista..."
                aria-label="Buscar canciones"
                className="field mb-4"
            />

            {error && <p className="notice mb-4" role="alert">{error}</p>}
            {notice && <p className="notice mb-4" role="status">{notice}</p>}
            {loading && <p className="muted">Cargando canciones...</p>}
            {!loading && !error && songs.length === 0 && <p className="muted">No hay canciones que coincidan.</p>}

            <ul className="space-y-2">
                {songs.map((song) => {
                    const busy = deletingId === song.id;
                    return (
                        <li key={song.id} className="card min-w-0 flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="font-semibold break-words">{song.title}</p>
                                <p className="muted text-sm break-words">
                                    {song.artist_name ?? "Artista desconocido"}
                                    {song.duration != null && ` · ${formatTime(song.duration)}`}
                                </p>
                            </div>
                            {confirmId === song.id ? (
                                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Confirmar borrado de ${song.title}`}>
                                    <span className="text-sm">¿Borrar?</span>
                                    <button type="button" onClick={() => deleteSong(song)} disabled={busy} className="btn-primary py-1 text-sm">
                                        {busy ? "Borrando..." : "Sí, borrar"}
                                    </button>
                                    <button type="button" onClick={() => setConfirmId(null)} disabled={busy} className="btn py-1 text-sm">
                                        Cancelar
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={() => setConfirmId(song.id)} className="btn py-1 text-sm">
                                    Borrar
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default function Admin() {
    return (
        <div className="page max-w-3xl">
            <h1 className="page-title mb-6">Administración</h1>
            <Users />
            <Songs />
        </div>
    );
}
