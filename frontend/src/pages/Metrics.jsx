import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import DailyPlaysChart, { changeLabel } from "../components/DailyPlaysChart";
import { artistLabel, errorMessage } from "../lib/format";

const POLL_MS = 5000;
const TOP_LIMIT = 10;
const TRENDING_DAYS = 7;
const TRENDING_LIMIT = 5;
const RANGES = [7, 30, 90];
// Igual a SONGS_IDS_MAX de catalog_service.
const IDS_PER_REQUEST = 100;

const plural = (n) => `${n} ${n === 1 ? "reproducción" : "reproducciones"}`;

/** Zona horaria del navegador, para que "hoy" sea el día de quien mira. */
function browserTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/*
 * Métricas de toda la plataforma (no solo de tus canciones), según metrics_service:
 *   GET /metrics/plays                    → { plays }                              total histórico
 *   GET /metrics/top                      → { songs: [{ song_id, total_plays }] }  de mayor a menor
 *   GET /metrics/plays/daily?days&tz      → { days: [{ date, plays }], total }     una barra por día
 *   GET /metrics/trending?days&limit      → { plays, previous_plays, songs: [{ song_id, plays, previous_plays }] }
 * El top y las tendencias traen solo ids: título y artista salen de
 *   GET /catalog/songs?ids=a,b,c (hasta 100 por pedido).
 * Todo se vuelve a pedir cada 5 segundos. La serie y las tendencias son aparte:
 * si fallan, el total y el top se siguen viendo.
 */
export default function Metrics() {

    const [total, setTotal] = useState(null);
    const [top, setTop] = useState([]);
    const [daily, setDaily] = useState(null);
    const [trend, setTrend] = useState(null);
    const [range, setRange] = useState(30);
    const [songsById, setSongsById] = useState({});
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Ids que ya se buscaron en el catálogo (estén o no): no se piden de nuevo en cada vuelta.
    const requested = useRef(new Set());

    useEffect(() => {
        // Propios de esta montura: si la página se cierra con un pedido en vuelo,
        // la respuesta se descarta y no se agenda otra vuelta del polling.
        let alive = true;
        let timer = null;
        const tz = browserTimeZone();

        async function loadNames(ids) {
            const missing = [...new Set(ids)].filter((id) => !requested.current.has(id));
            if (missing.length === 0) return;
            missing.forEach((id) => requested.current.add(id));
            for (let i = 0; i < missing.length; i += IDS_PER_REQUEST) {
                const chunk = missing.slice(i, i + IDS_PER_REQUEST);
                try {
                    const { data } = await api.get("/catalog/songs", { params: { ids: chunk.join(","), limit: IDS_PER_REQUEST } });
                    if (!alive) return;
                    setSongsById((prev) => ({ ...prev, ...Object.fromEntries(data.map((song) => [song.id, song])) }));
                } catch {
                    // Se reintenta en la próxima vuelta.
                    chunk.forEach((id) => requested.current.delete(id));
                }
            }
        }

        async function loadExtras() {
            const [series, trending] = await Promise.allSettled([
                api.get("/metrics/plays/daily", { params: { days: range, tz } }),
                api.get("/metrics/trending", { params: { days: TRENDING_DAYS, limit: TRENDING_LIMIT } })
            ]);
            if (!alive) return [];
            if (series.status === "fulfilled") setDaily(series.value.data);
            else setDaily((prev) => prev ?? "error");
            if (trending.status === "fulfilled") {
                setTrend(trending.value.data);
                return trending.value.data.songs.map((s) => s.song_id);
            }
            setTrend((prev) => prev ?? "error");
            return [];
        }

        async function loadMetrics() {
            try {
                const [plays, ranking, trendIds] = await Promise.all([
                    api.get("/metrics/plays"),
                    api.get("/metrics/top", { params: { limit: TOP_LIMIT } }),
                    loadExtras()
                ]);
                if (!alive) return;
                setTotal(plays.data.plays);
                setTop(ranking.data.songs);
                setUpdatedAt(new Date());
                setError("");
                await loadNames([...ranking.data.songs.map((s) => s.song_id), ...trendIds]);
            } catch (err) {
                if (alive) setError(errorMessage(err, "No se pudieron cargar las métricas."));
            } finally {
                if (alive) {
                    setLoading(false);
                    timer = setTimeout(loadMetrics, POLL_MS);
                }
            }
        }

        loadMetrics();
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [range]);

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
                        {trend && trend !== "error" && (
                            <p className="text-sm mt-2">
                                <strong className="tabular-nums">{plural(trend.plays)}</strong> en los últimos {TRENDING_DAYS} días
                                <span className="muted"> · {changeLabel(trend.plays, trend.previous_plays)} contra los {TRENDING_DAYS} anteriores ({trend.previous_plays})</span>
                            </p>
                        )}
                        <p className="muted text-sm mt-2">
                            Se actualiza sola cada {POLL_MS / 1000} segundos
                            {updatedAt && ` · última vez a las ${updatedAt.toLocaleTimeString()}`}
                        </p>
                    </section>

                    <section className="mb-8" aria-labelledby="daily-title">
                        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                            <div>
                                <h2 id="daily-title" className="section-title">Reproducciones por día</h2>
                                <p className="muted text-sm mt-1">
                                    {daily && daily !== "error"
                                        ? `${plural(daily.total)} en los últimos ${range} días.`
                                        : `Los últimos ${range} días.`}
                                </p>
                            </div>
                            <div className="flex" role="group" aria-label="Período">
                                {RANGES.map((days) => (
                                    <button
                                        key={days}
                                        type="button"
                                        aria-pressed={range === days}
                                        onClick={() => setRange(days)}
                                        className={`px-3 py-1 text-sm border border-black -ml-px first:ml-0 ${range === days ? "bg-black text-white" : "hover:bg-gray-100"}`}
                                    >
                                        {days} días
                                    </button>
                                ))}
                            </div>
                        </div>
                        {daily === "error" && <p className="muted">No se pudo cargar la serie por día.</p>}
                        {daily && daily !== "error" && (
                            <div className="card">
                                <DailyPlaysChart days={daily.days} title="Reproducciones por día" />
                            </div>
                        )}
                    </section>

                    <TrendingSection trend={trend} songsById={songsById} />

                    <section aria-labelledby="top-title">
                        <h2 id="top-title" className="section-title">Las más escuchadas</h2>
                        <p className="muted text-sm mt-1 mb-4">
                            Las {TOP_LIMIT} canciones con más reproducciones de siempre, de mayor a menor.
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
                                                    <SongName song={song} />
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

function SongName({ song }) {
    return (
        <div className="min-w-0">
            <p className="font-semibold break-words">{song ? song.title : "Canción no disponible"}</p>
            <p className="muted text-sm">{song ? artistLabel(song) : "Ya no está en el catálogo"}</p>
        </div>
    );
}

/** Las más escuchadas de la semana, con cuánto cambiaron contra la semana anterior. */
function TrendingSection({ trend, songsById }) {
    if (!trend) return null;
    return (
        <section className="mb-8" aria-labelledby="trend-title">
            <h2 id="trend-title" className="section-title">Tendencias de la semana</h2>
            <p className="muted text-sm mt-1 mb-4">
                Lo más escuchado en los últimos {TRENDING_DAYS} días y cómo le fue en los {TRENDING_DAYS} anteriores.
            </p>
            {trend === "error" && <p className="muted">No se pudieron cargar las tendencias.</p>}
            {trend !== "error" && trend.songs.length === 0 && (
                <p className="muted">Nadie escuchó nada en los últimos {TRENDING_DAYS} días.</p>
            )}
            {trend !== "error" && trend.songs.length > 0 && (
                <ul className="divide-y divide-black border-y border-black" aria-label="Tendencias">
                    {trend.songs.map((entry) => {
                        const change = changeLabel(entry.plays, entry.previous_plays);
                        const up = entry.plays > entry.previous_plays;
                        return (
                            <li key={entry.song_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                                <SongName song={songsById[entry.song_id]} />
                                <div className="text-sm text-right tabular-nums">
                                    <p>{plural(entry.plays)}</p>
                                    <p className="muted">
                                        <span aria-hidden="true">{up ? "▲" : entry.plays === entry.previous_plays ? "■" : "▼"} </span>
                                        {change}
                                        <span className="sr-only"> contra la semana anterior</span>
                                        {" "}(antes {entry.previous_plays})
                                    </p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
