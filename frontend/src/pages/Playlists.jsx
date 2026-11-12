import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { errorMessage, filterByTitle } from "../lib/format";

/*
 * Usa estos endpoints de catalog_service (app/playlists.py):
 *
 *   GET    /playlists        → playlists del usuario del JWT:
 *                              [{ id, name, song_count }]
 *   POST   /playlists        → body { name } → 201 { id, name, song_count }
 *   DELETE /playlists/{id}   → 204. 403 si es de otro, 404 si no existe.
 *
 * Si el catálogo desplegado es una versión vieja sin playlists, responde 404/405:
 * la página lo muestra como "todavía no disponible" en vez de un error.
 */
const NOT_READY = [404, 405];
const MAX_NAME = 100;

export default function Playlists() {

    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notReady, setNotReady] = useState(false);
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");

    const [name, setName] = useState("");
    const [creating, setCreating] = useState(false);

    const [confirmId, setConfirmId] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    // filterByTitle busca en .title; las playlists tienen .name.
    const visible = filterByTitle(playlists.map((p) => ({ ...p, title: p.name })), query);

    async function loadPlaylists() {
        try {
            const { data } = await api.get("/catalog/playlists");
            setPlaylists(data);
            setError("");
            setNotReady(false);
        } catch (err) {
            if (NOT_READY.includes(err?.response?.status)) {
                setNotReady(true);
            } else {
                setError(errorMessage(err, "No se pudieron cargar tus playlists."));
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadPlaylists();
    }, []);

    async function createPlaylist(e) {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;

        setCreating(true);
        setNotice("");
        try {
            const { data } = await api.post("/catalog/playlists", { name: trimmed });
            setPlaylists((prev) => [{ song_count: 0, ...data }, ...prev]);
            setName("");
            setNotice(`Se creó "${data.name ?? trimmed}".`);
        } catch (err) {
            if (NOT_READY.includes(err?.response?.status)) {
                setNotice("Crear playlists todavía no está disponible.");
            } else {
                setNotice(errorMessage(err, "No se pudo crear la playlist."));
            }
        } finally {
            setCreating(false);
        }
    }

    async function deletePlaylist(playlist) {
        setDeletingId(playlist.id);
        setNotice("");
        try {
            await api.delete(`/catalog/playlists/${playlist.id}`);
            setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
            setNotice(`"${playlist.name}" se borró.`);
        } catch (err) {
            const status = err?.response?.status;
            if (status === 404) {
                setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
                setNotice(`"${playlist.name}" ya no existía.`);
            } else if (status === 403) {
                setNotice("Solo podés borrar tus propias playlists.");
            } else {
                setNotice(errorMessage(err, "No se pudo borrar la playlist."));
            }
        } finally {
            setDeletingId(null);
            setConfirmId(null);
        }
    }

    return (
        <div className="page">

            <h1 className="page-title mb-6">Playlists</h1>

            <form onSubmit={createPlaylist} className="card max-w-3xl mb-6 flex flex-wrap items-end gap-2">
                <label className="flex-1 min-w-48">
                    <span className="block text-sm mb-1">Nueva playlist</span>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={MAX_NAME}
                        placeholder="Nombre de la playlist"
                        className="field"
                        disabled={notReady}
                    />
                </label>
                <button
                    type="submit"
                    disabled={creating || notReady || !name.trim()}
                    className="btn-primary"
                >
                    {creating ? "Creando..." : "Crear"}
                </button>
            </form>

            {loading && <p className="muted">Cargando tus playlists...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {notReady && (
                <p className="notice mb-4" role="status">
                    Esta sección todavía no está disponible: falta que el catálogo guarde las playlists de cada usuario.
                </p>
            )}

            {notice && <p className="notice mb-4" role="status">{notice}</p>}

            {!loading && !error && !notReady && playlists.length === 0 && (
                <p className="muted">Todavía no creaste playlists. Poné un nombre arriba para armar la primera.</p>
            )}

            {playlists.length > 0 && (
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar playlist..."
                    aria-label="Buscar entre tus playlists"
                    className="field max-w-md mb-6"
                />
            )}

            {playlists.length > 0 && visible.length === 0 && (
                <p className="muted">Ninguna playlist coincide con "{query.trim()}".</p>
            )}

            <ul className="space-y-4 max-w-3xl">
                {visible.map((playlist) => {
                    const busy = deletingId === playlist.id;
                    return (
                        <li key={playlist.id} className="card min-w-0 flex flex-wrap items-center justify-between gap-2">

                            <Link to={`/playlists/${playlist.id}`} className="min-w-0 flex-1 hover:underline underline-offset-2">
                                <h2 className="font-semibold break-words">{playlist.name}</h2>
                                <p className="muted text-sm">
                                    {playlist.song_count === 1 ? "1 canción" : `${playlist.song_count ?? 0} canciones`}
                                </p>
                            </Link>

                            {confirmId === playlist.id ? (
                                <div className="flex items-center gap-2" role="group" aria-label={`Confirmar borrado de ${playlist.name}`}>
                                    <span className="text-sm">¿Borrar?</span>
                                    <button
                                        type="button"
                                        onClick={() => deletePlaylist(playlist)}
                                        disabled={busy}
                                        className="btn-primary py-1 text-sm"
                                    >
                                        {busy ? "Borrando..." : "Sí, borrar"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmId(null)}
                                        disabled={busy}
                                        className="btn py-1 text-sm"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Link to={`/playlists/${playlist.id}`} className="btn py-1 text-sm">Abrir</Link>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmId(playlist.id)}
                                        className="btn py-1 text-sm"
                                    >
                                        Borrar
                                    </button>
                                </div>
                            )}

                        </li>
                    );
                })}
            </ul>

        </div>
    );
}
