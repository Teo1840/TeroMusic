import { useState } from "react";
import api from "../api/client";
import { errorMessage } from "../lib/format";
import { CheckIcon, PlusIcon } from "./Icons";

const MAX_NAME = 100;

/**
 * Agregar una canción a una playlist sin salir del catálogo:
 * se abre la lista de playlists y un clic en una la agrega. También se puede crear una
 * playlist nueva ahí mismo, que ya queda con la canción adentro.
 */
export default function AddToPlaylist({ song }) {
    const [open, setOpen] = useState(false);
    const [playlists, setPlaylists] = useState([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    // Playlists donde ya está la canción (agregada ahora o que ya la tenían: 409).
    const [added, setAdded] = useState(() => new Set());
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);

    const busy = busyId !== null || creating;

    async function showPlaylists() {
        setOpen(true);
        setLoading(true);
        setLoadError("");
        setError("");
        setNotice("");
        try {
            const { data } = await api.get("/catalog/playlists");
            setPlaylists(data);
        } catch (err) {
            setLoadError(errorMessage(err, "No se pudieron cargar tus playlists."));
        } finally {
            setLoading(false);
        }
    }

    const markAdded = (id) => setAdded((prev) => new Set(prev).add(id));

    /** Agrega la canción. true si quedó en la playlist (también si ya estaba). */
    async function addTo(playlist) {
        try {
            await api.post(`/catalog/playlists/${playlist.id}/songs`, { song_id: song.id });
            markAdded(playlist.id);
            setNotice(`Se agregó "${song.title}" a "${playlist.name}".`);
            return true;
        } catch (err) {
            if (err?.response?.status === 409) {
                markAdded(playlist.id);
                setNotice(`"${song.title}" ya está en "${playlist.name}".`);
                return true;
            }
            setError(errorMessage(err, `No se pudo agregar a "${playlist.name}".`));
            return false;
        }
    }

    async function pick(playlist) {
        if (busy || added.has(playlist.id)) return;
        setBusyId(playlist.id);
        setError("");
        setNotice("");
        await addTo(playlist);
        setBusyId(null);
    }

    async function createAndAdd(e) {
        e.preventDefault();
        const name = newName.trim();
        if (!name || busy) return;
        setCreating(true);
        setError("");
        setNotice("");
        try {
            const { data } = await api.post("/catalog/playlists", { name });
            setPlaylists((prev) => [data, ...prev]);
            setNewName("");
            if (await addTo(data)) setNotice(`Se creó "${data.name}" con "${song.title}".`);
        } catch (err) {
            setError(errorMessage(err, "No se pudo crear la playlist."));
        } finally {
            setCreating(false);
        }
    }

    return (
        <div className="mt-3">
            <button type="button" className="btn py-1 text-sm" aria-expanded={open}
                onClick={() => (open ? setOpen(false) : showPlaylists())} disabled={busy}>
                {open ? "Cerrar playlists" : "Agregar a playlist"}
            </button>

            {open && (
                <div className="mt-2 space-y-2">
                    {loading ? <p className="muted text-sm">Cargando playlists...</p> : loadError ? (
                        <div>
                            <p className="notice text-sm" role="alert">{loadError}</p>
                            <button type="button" className="link text-sm" onClick={showPlaylists}>Volver a cargar playlists</button>
                        </div>
                    ) : (
                        <>
                            {playlists.length === 0 ? (
                                <p className="muted text-sm">Todavía no tenés playlists. Creá la primera:</p>
                            ) : (
                                <ul className="border border-black divide-y divide-black max-h-48 overflow-y-auto text-sm"
                                    aria-label={`Tus playlists para "${song.title}"`}>
                                    {playlists.map((playlist) => {
                                        const isIn = added.has(playlist.id);
                                        return (
                                            <li key={playlist.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => pick(playlist)}
                                                    disabled={busy || isIn}
                                                    aria-label={isIn ? `${playlist.name} (ya está)` : `Agregar a ${playlist.name}`}
                                                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black hover:text-white disabled:hover:bg-white disabled:hover:text-black"
                                                >
                                                    <span className="flex-1 min-w-0 break-words">{playlist.name}</span>
                                                    {busyId === playlist.id
                                                        ? <span className="text-xs">Agregando...</span>
                                                        : isIn ? <CheckIcon /> : <PlusIcon />}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}

                            <form onSubmit={createAndAdd} className="flex gap-2">
                                <input
                                    className="field py-1 text-sm min-w-0 flex-1"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    maxLength={MAX_NAME}
                                    placeholder="Nueva playlist"
                                    aria-label="Nombre de la nueva playlist"
                                    disabled={creating}
                                />
                                <button type="submit" className="btn-primary py-1 text-sm shrink-0" disabled={busy || !newName.trim()}>
                                    {creating ? "Creando..." : "Crear y agregar"}
                                </button>
                            </form>
                        </>
                    )}
                    {error && <p className="notice text-sm" role="alert">{error}</p>}
                    {notice && <p className="notice text-sm" role="status">{notice}</p>}
                </div>
            )}
        </div>
    );
}
