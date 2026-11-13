import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import AudioPlayer from "../components/AudioPlayer";
import AddToPlaylist from "../components/AddToPlaylist";
import { PlusIcon } from "../components/Icons";
import { SORTS, artistsOf, songCount, sortSongs } from "../lib/catalog";
import { artistLabel, errorMessage, filterByTitle, formatTime, initials } from "../lib/format";

const ALL = null;

export default function Catalog() {

    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState(SORTS[0].id);
    const [artistId, setArtistId] = useState(ALL);

    const artists = useMemo(() => artistsOf(songs), [songs]);
    const selectedArtist = artists.find((a) => a.id === artistId);

    const visibleSongs = useMemo(() => {
        const byArtist = artistId === ALL ? songs : songs.filter((s) => (s.artist_id ?? "") === artistId);
        return sortSongs(filterByTitle(byArtist, query), sort);
    }, [songs, artistId, query, sort]);

    const filtering = query.trim() !== "" || artistId !== ALL;

    async function loadSongs() {
        setLoading(true);
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

    function clearFilters() {
        setQuery("");
        setArtistId(ALL);
    }

    const ready = !loading && !error;

    return (
        <div className="page">

            <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h1 className="page-title">Catálogo</h1>
                    {ready && songs.length > 0 && (
                        <p className="muted text-sm mt-1">
                            {songCount(songs.length)} · {artists.length === 1 ? "1 artista" : `${artists.length} artistas`}
                        </p>
                    )}
                </div>
                <Link to="/upload" className="btn-primary">
                    <PlusIcon /> Subir canción
                </Link>
            </header>

            {ready && songs.length > 0 && (
                // Queda fija arriba al bajar: en el celular el catálogo es una lista larga.
                <div className="sticky top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 py-3 mb-4 bg-white border-b border-black">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Buscar por canción o artista..."
                            aria-label="Buscar canciones por nombre o artista"
                            className="field sm:flex-1"
                        />
                        <label className="flex items-center gap-2 text-sm sm:w-56">
                            <span className="shrink-0">Ordenar</span>
                            <select value={sort} onChange={(e) => setSort(e.target.value)} className="field">
                                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                        </label>
                    </div>
                </div>
            )}

            {loading && <SkeletonGrid />}

            {error && (
                <div className="notice flex flex-wrap items-center justify-between gap-2 mb-4" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={loadSongs} className="btn py-1 text-sm">Reintentar</button>
                </div>
            )}

            {ready && songs.length === 0 && (
                <div className="card text-center py-12">
                    <p className="font-semibold">Todavía no hay canciones.</p>
                    <p className="muted text-sm mt-1 mb-4">Las que subas aparecen acá cuando terminan de procesarse.</p>
                    <Link to="/upload" className="btn-primary">Subí la primera</Link>
                </div>
            )}

            {ready && songs.length > 0 && (
                <p className="muted text-sm mb-4" aria-live="polite">
                    {filtering
                        ? <>
                            {visibleSongs.length === 1 ? "1 resultado" : `${visibleSongs.length} resultados`}
                            {selectedArtist && <> de <strong className="text-black">{selectedArtist.name}</strong></>}
                            {query.trim() && <> para "{query.trim()}"</>}
                            {" · "}
                            <button type="button" onClick={clearFilters} className="link">Limpiar filtros</button>
                        </>
                        : `Mostrando ${songCount(songs.length)}`}
                </p>
            )}

            {ready && songs.length > 0 && visibleSongs.length === 0 && (
                <p className="muted">Ninguna canción coincide con la búsqueda.</p>
            )}

            {ready && visibleSongs.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {visibleSongs.map((song) => (
                        <SongCard
                            key={song.id}
                            song={song}
                            onArtist={() => setArtistId(song.artist_id ?? "")}
                        />
                    ))}
                </div>
            )}

        </div>
    );
}

function SongCard({ song, onArtist }) {
    const artist = artistLabel(song);
    return (
        <article className="card min-w-0 flex flex-col">
            <div className="flex items-start gap-3">
                <div
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center bg-black font-bold text-white"
                >
                    {initials(artist)}
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug break-words">{song.title}</h2>
                    <button
                        type="button"
                        onClick={onArtist}
                        title={`Ver canciones de ${artist}`}
                        className="text-sm muted text-left break-words hover:underline underline-offset-2"
                    >
                        {artist}
                    </button>
                </div>
                {Number.isFinite(song.duration) && (
                    <span className="text-xs muted tabular-nums shrink-0 pt-0.5">{formatTime(song.duration)}</span>
                )}
            </div>
            <AudioPlayer songId={song.id} />
            <div className="mt-auto">
                <AddToPlaylist song={song} />
            </div>
        </article>
    );
}

function SkeletonGrid() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true">
            <p className="sr-only" role="status">Cargando canciones...</p>
            {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card motion-safe:animate-pulse" aria-hidden="true">
                    <div className="flex items-start gap-3">
                        <div className="h-12 w-12 bg-gray-200" />
                        <div className="flex-1 space-y-2 pt-1">
                            <div className="h-4 w-3/4 bg-gray-200" />
                            <div className="h-3 w-1/2 bg-gray-200" />
                        </div>
                    </div>
                    <div className="h-10 mt-3 bg-gray-200" />
                    <div className="h-7 w-36 mt-3 bg-gray-200" />
                </div>
            ))}
        </div>
    );
}
