import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/client";
import { SkeletonGrid, SongGrid } from "./Catalog";
import { SORTS, songCount } from "../lib/catalog";
import { errorMessage, initials } from "../lib/format";
import { useSongPages } from "../lib/songs";

// En la página de un artista no tiene sentido ordenar por artista.
const ARTIST_SORTS = SORTS.filter((s) => s.id !== "artist");

/**
 * Página de un artista: su nombre y sus canciones publicadas, de a páginas.
 * GET /catalog/artists/{id} (perfil) y GET /catalog/songs?artist_id={id}&sort=&limit=&offset=.
 */
export default function Artist() {
    const { artistId } = useParams();
    const [artist, setArtist] = useState(null);
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileError, setProfileError] = useState("");
    const [notFound, setNotFound] = useState(false);
    const [sort, setSort] = useState(ARTIST_SORTS[0].id);
    const pages = useSongPages({ artist_id: artistId, sort });

    async function loadProfile() {
        setProfileLoading(true);
        setProfileError("");
        setNotFound(false);
        try {
            const { data } = await api.get(`/catalog/artists/${artistId}`);
            setArtist(data);
        } catch (err) {
            const status = err?.response?.status;
            if (status === 404 || status === 422) setNotFound(true);
            else setProfileError(errorMessage(err, "No se pudo cargar el artista."));
        } finally {
            setProfileLoading(false);
        }
    }

    useEffect(() => {
        loadProfile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artistId]);

    function retry() {
        if (profileError) loadProfile();
        if (pages.error) pages.reload();
    }

    const { songs, total } = pages;
    const loading = profileLoading || (pages.loading && songs.length === 0);
    const error = profileError || (pages.error && songs.length === 0 ? errorMessage(pages.error, "No se pudieron cargar las canciones.") : "");
    // El perfil puede no haber llegado al catálogo todavía: se usa el nombre que traen las canciones.
    const name = artist?.display_name || songs[0]?.artist_name || "Artista desconocido";

    return (
        <div className="page">

            <p className="text-sm mb-4">
                <Link to="/catalog" className="link">← Catálogo</Link>
            </p>

            {loading && (
                <>
                    <div className="flex items-center gap-4 mb-6" aria-hidden="true">
                        <div className="h-20 w-20 bg-gray-200 motion-safe:animate-pulse" />
                        <div className="h-8 w-48 bg-gray-200 motion-safe:animate-pulse" />
                    </div>
                    <SkeletonGrid />
                </>
            )}

            {!loading && notFound && (
                <div className="card text-center py-12">
                    <p className="font-semibold">No encontramos a este artista.</p>
                    <p className="muted text-sm mt-1 mb-4">Puede que el enlace esté mal o que ya no tenga canciones.</p>
                    <Link to="/catalog" className="btn-primary">Ir al catálogo</Link>
                </div>
            )}

            {!loading && error && (
                <div className="notice flex flex-wrap items-center justify-between gap-2" role="alert">
                    <span>{error}</span>
                    <button type="button" onClick={retry} className="btn py-1 text-sm">Reintentar</button>
                </div>
            )}

            {!loading && !error && !notFound && (
                <>
                    <header className="flex flex-wrap items-center gap-4 mb-6">
                        <div
                            aria-hidden="true"
                            className="flex h-20 w-20 shrink-0 items-center justify-center bg-black text-2xl font-bold text-white"
                        >
                            {initials(name)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs uppercase tracking-wide muted">Artista</p>
                            <h1 className="page-title break-words">{name}</h1>
                            <p className="muted text-sm mt-1">
                                {artist?.username && <>@{artist.username} · </>}
                                {songCount(total)}
                            </p>
                        </div>
                        {total > 1 && (
                            <label className="flex items-center gap-2 text-sm w-full sm:w-56">
                                <span className="shrink-0">Ordenar</span>
                                <select value={sort} onChange={(e) => setSort(e.target.value)} className="field">
                                    {ARTIST_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                                </select>
                            </label>
                        )}
                    </header>

                    {total === 0 ? (
                        <p className="muted">Todavía no tiene canciones publicadas.</p>
                    ) : (
                        <SongGrid
                            songs={songs}
                            busy={pages.loading}
                            hasMore={pages.hasMore}
                            loadingMore={pages.loadingMore}
                            onMore={pages.loadMore}
                            showArtist={false}
                        />
                    )}
                </>
            )}

        </div>
    );
}
