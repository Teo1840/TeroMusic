import { useState } from "react";
import { Link } from "react-router-dom";
import { PlusIcon } from "../components/Icons";
import SongCard from "../components/SongCard";
import { SORTS, songCount } from "../lib/catalog";
import { errorMessage } from "../lib/format";
import { useDebounced, useSongPages } from "../lib/songs";

/**
 * Catálogo: canciones publicadas de a páginas. La búsqueda (título o artista) y el orden
 * los resuelve el server (GET /catalog/songs?q=&sort=&limit=&offset=), así no se trae todo.
 */
export default function Catalog() {

    const [query, setQuery] = useState("");
    const [sort, setSort] = useState(SORTS[0].id);
    const term = useDebounced(query.trim(), 300);
    const { songs, total, loading, loadingMore, error, hasMore, loadMore, reload } = useSongPages({ q: term, sort });

    const filtering = term !== "";
    // Sin búsqueda y sin resultados: el catálogo está vacío de verdad.
    const empty = !loading && !error && !filtering && total === 0;
    const firstLoad = loading && songs.length === 0;

    return (
        <div className="page">

            <header className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h1 className="page-title">Catálogo</h1>
                    {!loading && !error && !filtering && total > 0 && (
                        <p className="muted text-sm mt-1">{songCount(total)}</p>
                    )}
                </div>
                <Link to="/upload" className="btn-primary">
                    <PlusIcon /> Subir canción
                </Link>
            </header>

            {!empty && (
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

            {firstLoad && <SkeletonGrid />}

            {error && (
                <div className="notice flex flex-wrap items-center justify-between gap-2 mb-4" role="alert">
                    <span>{errorMessage(error, "No se pudo cargar el catálogo.")}</span>
                    <button type="button" onClick={reload} className="btn py-1 text-sm">Reintentar</button>
                </div>
            )}

            {empty && (
                <div className="card text-center py-12">
                    <p className="font-semibold">Todavía no hay canciones.</p>
                    <p className="muted text-sm mt-1 mb-4">Las que subas aparecen acá cuando terminan de procesarse.</p>
                    <Link to="/upload" className="btn-primary">Subí la primera</Link>
                </div>
            )}

            {!firstLoad && !error && !empty && (
                <p className="muted text-sm mb-4" aria-live="polite">
                    {filtering
                        ? <>
                            {total === 1 ? "1 resultado" : `${total} resultados`}
                            {` para "${term}"`}
                            {" · "}
                            <button type="button" onClick={() => setQuery("")} className="link">Limpiar búsqueda</button>
                        </>
                        : `Mostrando ${songs.length} de ${songCount(total)}`}
                </p>
            )}

            {!loading && !error && filtering && songs.length === 0 && (
                <p className="muted">Ninguna canción coincide con la búsqueda.</p>
            )}

            {!firstLoad && songs.length > 0 && (
                <SongGrid songs={songs} busy={loading} hasMore={hasMore} loadingMore={loadingMore} onMore={loadMore} />
            )}

        </div>
    );
}

/** Grilla de tarjetas con "Cargar más". La usan el catálogo y la página del artista. */
export function SongGrid({ songs, busy, hasMore, loadingMore, onMore, showArtist = true }) {
    return (
        <>
            <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 ${busy ? "opacity-50" : ""}`} aria-busy={busy}>
                {songs.map((song) => <SongCard key={song.id} song={song} queue={songs} showArtist={showArtist} />)}
            </div>
            {hasMore && (
                <div className="mt-6 text-center">
                    <button type="button" onClick={onMore} disabled={loadingMore} className="btn">
                        {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                </div>
            )}
        </>
    );
}

export function SkeletonGrid() {
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
