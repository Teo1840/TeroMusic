import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import { artistLabel, errorMessage } from "../lib/format";

const POLL_MS = 5000;
const TOP_LIMIT = 10;

const plural = (n) => `${n} ${n === 1 ? "reproducción" : "reproducciones"}`;

/*
 * Métricas de toda la plataforma (no solo de tus canciones), según metrics_service:
 *   GET /metrics/plays → { plays }                              total de todas las canciones
 *   GET /metrics/top   → { songs: [{ song_id, total_plays }] }  de mayor a menor
 * El top trae solo ids: el título y el artista salen del catálogo.
 */
export default function Metrics() {

    const [total, setTotal] = useState(null);
    const [top, setTop] = useState([]);
    const [songsById, setSongsById] = useState({});
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const pollTimer = useRef(null);
    const knownIds = useRef(new Set());

    async function loadCatalog() {
        const { data } = await api.get("/catalog/songs");
        knownIds.current = new Set(data.map((song) => song.id));
        setSongsById(Object.fromEntries(data.map((song) => [song.id, song])));
    }

    async function loadMetrics() {
        clearTimeout(pollTimer.current);
        try {
            const [plays, ranking] = await Promise.all([
                api.get("/metrics/plays"),
                api.get("/metrics/top", { params: { limit: TOP_LIMIT } })
            ]);
            setTotal(plays.data.plays);
            setTop(ranking.data.songs);
            setUpdatedAt(new Date());
            setError("");

            // Si entró al top una canción que todavía no conocemos, se recarga el catálogo.
            if (ranking.data.songs.some((s) => !knownIds.current.has(s.song_id))) {
                await loadCatalog().catch(() => {});
            }
        } catch (err) {
            setError(errorMessage(err, "No se pudieron cargar las métricas."));
        } finally {
            setLoading(false);
            pollTimer.current = setTimeout(loadMetrics, POLL_MS);
        }
    }

    useEffect(() => {
        loadCatalog().catch(() => {}).finally(loadMetrics);
        return () => clearTimeout(pollTimer.current);
    }, []);

    const maxPlays = top[0]?.total_plays || 1;

    return (
        <div className="page max-w-3xl">

            <h1 className="page-title">Métricas</h1>
            <p className="muted mt-2 mb-6">
                Cuántas veces se escucharon las canciones de toda la plataforma, sumando a todos los usuarios.
                Una reproducción se cuenta cuando alguien termina una canción o la deja de escuchar.
            </p>

            {loading && <p className="muted">Cargando métricas...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {!loading && total !== null && (
                <>
                    <section className="card mb-8" aria-labelledby="total-title">
                        <h2 id="total-title" className="muted text-sm">Reproducciones en total</h2>
                        <p className="text-5xl font-bold tabular-nums mt-1">{total}</p>
                        <p className="muted text-sm mt-2">
                            Se actualiza sola cada {POLL_MS / 1000} segundos
                            {updatedAt && ` · última vez a las ${updatedAt.toLocaleTimeString()}`}
                        </p>
                    </section>

                    <section aria-labelledby="top-title">
                        <h2 id="top-title" className="section-title">Las más escuchadas</h2>
                        <p className="muted text-sm mt-1 mb-4">
                            Las {TOP_LIMIT} canciones con más reproducciones, de mayor a menor.
                        </p>

                        {top.length === 0 ? (
                            <p className="muted">
                                Todavía nadie terminó de escuchar una canción. Cuando pase, aparece acá.
                            </p>
                        ) : (
                            <ol className="space-y-3">
                                {top.map((entry, index) => {
                                    const song = songsById[entry.song_id];
                                    return (
                                        <li key={entry.song_id} className="card flex items-center gap-4">
                                            <span className="text-2xl font-bold tabular-nums w-8 shrink-0 text-center">
                                                {index + 1}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                                                    <div className="min-w-0">
                                                        <p className="font-semibold break-words">
                                                            {song ? song.title : "Canción no disponible"}
                                                        </p>
                                                        <p className="muted text-sm">
                                                            {song ? artistLabel(song) : "Ya no está en el catálogo"}
                                                        </p>
                                                    </div>
                                                    <p className="text-sm tabular-nums whitespace-nowrap">
                                                        {plural(entry.total_plays)}
                                                    </p>
                                                </div>
                                                <div className="h-1.5 bg-gray-200 mt-2" aria-hidden="true">
                                                    <div
                                                        className="h-full bg-black"
                                                        style={{ width: `${(entry.total_plays / maxPlays) * 100}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </section>
                </>
            )}

        </div>
    );
}
