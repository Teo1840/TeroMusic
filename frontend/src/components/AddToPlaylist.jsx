import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { errorMessage } from "../lib/format";

export default function AddToPlaylist({ song }) {
    const [open, setOpen] = useState(false);
    const [playlists, setPlaylists] = useState([]);
    const [playlistId, setPlaylistId] = useState("");
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    async function showPlaylists() {
        setOpen(true);
        setLoading(true);
        setError("");
        setNotice("");
        try {
            const { data } = await api.get("/catalog/playlists");
            setPlaylists(data);
            setPlaylistId(data[0]?.id ?? "");
        } catch (err) {
            setError(errorMessage(err, "No se pudieron cargar tus playlists."));
        } finally {
            setLoading(false);
        }
    }

    async function addSong(e) {
        e.preventDefault();
        if (!playlistId || saving) return;
        setSaving(true);
        setError("");
        setNotice("");
        const name = playlists.find((playlist) => playlist.id === playlistId)?.name;
        try {
            await api.post(`/catalog/playlists/${playlistId}/songs`, { song_id: song.id });
            setNotice(`Se agregó "${song.title}" a "${name}".`);
        } catch (err) {
            if (err?.response?.status === 409) {
                setNotice(`"${song.title}" ya está en "${name}".`);
            } else {
                setError(errorMessage(err, "No se pudo agregar la canción."));
            }
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="mt-3">
            <button type="button" className="btn py-1 text-sm" aria-expanded={open}
                onClick={() => open ? setOpen(false) : showPlaylists()} disabled={saving}>
                {open ? "Cerrar playlists" : "Agregar a playlist"}
            </button>
            {open && (
                <div className="mt-2">
                    {loading ? <p className="muted text-sm">Cargando playlists...</p> : error ? (
                        <div>
                            <p className="notice text-sm" role="alert">{error}</p>
                            <button type="button" className="link text-sm" onClick={showPlaylists}>Volver a cargar playlists</button>
                        </div>
                    ) : playlists.length === 0 ? (
                        <p className="muted text-sm">Todavía no tenés playlists. <Link to="/playlists" className="link">Crear una playlist</Link>.</p>
                    ) : (
                        <form onSubmit={addSong} className="flex flex-wrap items-end gap-2">
                            <label className="flex-1 min-w-0">
                                <span className="block text-sm mb-1">Playlist para "{song.title}"</span>
                                <select className="field" value={playlistId} disabled={saving}
                                    onChange={(e) => { setPlaylistId(e.target.value); setNotice(""); }}>
                                    {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
                                </select>
                            </label>
                            <button type="submit" className="btn-primary py-1 text-sm" disabled={saving || !playlistId}>
                                {saving ? "Agregando..." : "Agregar"}
                            </button>
                        </form>
                    )}
                    {notice && <p className="notice mt-2 text-sm" role="status">{notice}</p>}
                </div>
            )}
        </div>
    );
}
