import { useEffect, useState } from "react";
import api from "../api/client";
import AudioPlayer from "../components/AudioPlayer";
import UploadSong from "../components/UploadSong";
import { errorMessage, filterByTitle } from "../lib/format";

export default function Catalog() {

    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");

    const visibleSongs = filterByTitle(songs, query);

    async function loadSongs() {
        try {
            const { data } = await api.get("/catalog/songs");
            setSongs(data);
            setError("");
        } catch (err) {
            setError(errorMessage(err, "No se pudo cargar el catálogo."));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSongs();
    }, []);

    return (
        <div className="page">

            <h1 className="page-title mb-6">Catálogo</h1>

            <UploadSong onPublished={loadSongs} />

            <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre..."
                aria-label="Buscar canciones por nombre"
                className="field max-w-md mb-6"
            />

            {loading && <p className="muted">Cargando canciones...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {!loading && !error && songs.length === 0 && (
                <p className="muted">Todavía no hay canciones. Subí la primera.</p>
            )}

            {!loading && !error && songs.length > 0 && visibleSongs.length === 0 && (
                <p className="muted">Ninguna canción coincide con "{query.trim()}".</p>
            )}

            {!loading && !error && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visibleSongs.map((song) => (
                        <article key={song.id} className="card min-w-0">
                            <h2 className="font-semibold break-words">{song.title}</h2>
                            <AudioPlayer songId={song.id} />
                        </article>
                    ))}
                </div>
            )}

        </div>
    );
}
