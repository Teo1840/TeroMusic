import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import AudioPlayer from "../components/AudioPlayer";
import { errorMessage, filterByTitle, formatTime } from "../lib/format";

const POLL_MS = 3000;

/*
 * Lo que esta página espera de catalog_service (a cargo del Integrante 2):
 *
 *   GET    /songs/mine   → canciones del usuario del JWT, en cualquier estado:
 *                          [{ id, title, status, duration, error_message }]
 *                          (declararla antes de /songs/{song_id}, si no "mine" se lee como id)
 *   DELETE /songs/{id}   → 204. 403 si la canción es de otro, 404 si no existe.
 *
 * Mientras no existan, el catálogo responde 422 (a "mine") o 405 (al DELETE):
 * la página lo muestra como "todavía no disponible" en vez de un error.
 */
const NOT_READY = [404, 405, 422];

const STATUS_LABEL = {
    BORRADOR: "Procesando",
    PUBLICADO: "Publicada",
    FALLIDO: "Falló"
};

export default function MySongs() {

    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notReady, setNotReady] = useState(false);
    const [notice, setNotice] = useState("");
    const [query, setQuery] = useState("");
    const [confirmId, setConfirmId] = useState(null);  // canción con el "¿Borrar?" abierto
    const [deletingId, setDeletingId] = useState(null);

    const pollTimer = useRef(null);
    const visibleSongs = filterByTitle(songs, query);

    async function loadSongs() {
        clearTimeout(pollTimer.current);
        try {
            const { data } = await api.get("/catalog/songs/mine");
            setSongs(data);
            setError("");
            setNotReady(false);

            // Mientras alguna se esté procesando, se vuelve a consultar.
            if (data.some((song) => song.status === "BORRADOR")) {
                pollTimer.current = setTimeout(loadSongs, POLL_MS);
            }
        } catch (err) {
            if (NOT_READY.includes(err?.response?.status)) {
                setNotReady(true);
            } else {
                setError(errorMessage(err, "No se pudieron cargar tus canciones."));
            }
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSongs();
        return () => clearTimeout(pollTimer.current);
    }, []);

    async function deleteSong(song) {
        setDeletingId(song.id);
        setNotice("");
        try {
            await api.delete(`/catalog/songs/${song.id}`);
            setSongs((prev) => prev.filter((s) => s.id !== song.id));
            setNotice(`"${song.title}" se borró.`);
        } catch (err) {
            const status = err?.response?.status;
            if (status === 405) {
                setNotice("Borrar canciones todavía no está disponible.");
            } else if (status === 404) {
                // Ya no existe: se saca de la lista igual.
                setSongs((prev) => prev.filter((s) => s.id !== song.id));
                setNotice(`"${song.title}" ya no existía.`);
            } else if (status === 403) {
                setNotice("Solo podés borrar tus propias canciones.");
            } else {
                setNotice(errorMessage(err, "No se pudo borrar la canción."));
            }
        } finally {
            setDeletingId(null);
            setConfirmId(null);
        }
    }

    return (
        <div className="page">

            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
                <h1 className="page-title">Mis canciones</h1>
                <Link to="/upload" className="btn">Subir canción</Link>
            </div>

            {loading && <p className="muted">Cargando tus canciones...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {notReady && (
                <p className="notice mb-4" role="status">
                    Esta sección todavía no está disponible: falta que el catálogo devuelva las canciones de cada usuario.
                </p>
            )}

            {notice && <p className="notice mb-4" role="status">{notice}</p>}

            {!loading && !error && !notReady && songs.length === 0 && (
                <p className="muted">
                    Todavía no subiste canciones. <Link to="/upload" className="link">Subí la primera</Link>.
                </p>
            )}

            {songs.length > 0 && (
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar por nombre..."
                    aria-label="Buscar entre tus canciones"
                    className="field max-w-md mb-6"
                />
            )}

            {songs.length > 0 && visibleSongs.length === 0 && (
                <p className="muted">Ninguna canción coincide con "{query.trim()}".</p>
            )}

            <ul className="space-y-4 max-w-3xl">
                {visibleSongs.map((song) => {
                    const busy = deletingId === song.id;
                    return (
                        <li key={song.id} className="card min-w-0">

                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h2 className="font-semibold break-words">{song.title}</h2>
                                    <p className="muted text-sm">
                                        {STATUS_LABEL[song.status] ?? song.status}
                                        {song.duration != null && ` · ${formatTime(song.duration)}`}
                                    </p>
                                    {song.status === "FALLIDO" && song.error_message && (
                                        <p className="muted text-sm break-words">{song.error_message}</p>
                                    )}
                                </div>

                                {confirmId === song.id ? (
                                    <div className="flex items-center gap-2" role="group" aria-label={`Confirmar borrado de ${song.title}`}>
                                        <span className="text-sm">¿Borrar?</span>
                                        <button
                                            type="button"
                                            onClick={() => deleteSong(song)}
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
                                    <button
                                        type="button"
                                        onClick={() => setConfirmId(song.id)}
                                        className="btn py-1 text-sm"
                                    >
                                        Borrar
                                    </button>
                                )}
                            </div>

                            {song.status === "PUBLICADO" && <AudioPlayer songId={song.id} />}

                        </li>
                    );
                })}
            </ul>

        </div>
    );
}
