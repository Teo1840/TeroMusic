import { useEffect, useState } from "react";
import { fetchSongs, useDebounced } from "../lib/songs";
import { normalize } from "../lib/format";

const MAX_RESULTS = 10;

/**
 * Buscador de canciones: no carga el catálogo entero, le pregunta al server
 * (GET /catalog/songs?q=) con lo escrito, por título o artista.
 * `exclude`: ids que no se ofrecen (p. ej. las que ya están en la playlist).
 * Al elegir una llama a onPick(song) y se limpia.
 */
export default function SongSearch({ label, icon, actionIcon, onPick, exclude }) {
    const [search, setSearch] = useState("");
    const term = useDebounced(search.trim(), 250);
    const [results, setResults] = useState([]);
    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const hasTerm = normalize(search) !== "";

    useEffect(() => {
        if (!term) {
            setResults([]);
            setStatus("idle");
            return undefined;
        }
        let cancelled = false;
        setStatus("loading");
        // Se piden de más para que alcancen aunque algunas estén excluidas.
        fetchSongs({ q: term, limit: MAX_RESULTS + (exclude?.size ?? 0) })
            .then(({ songs }) => {
                if (cancelled) return;
                setResults(songs);
                setStatus("done");
            })
            .catch(() => { if (!cancelled) setStatus("error"); });
        return () => { cancelled = true; };
        // exclude cambia de identidad en cada render: lo que importa es lo buscado.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [term]);

    const visible = results.filter((song) => !exclude?.has(song.id)).slice(0, MAX_RESULTS);
    const waiting = hasTerm && (status === "loading" || term !== search.trim());

    function pick(song) {
        onPick(song);
        setSearch("");
    }

    return (
        <div className="text-sm">
            <label className="flex flex-wrap items-center gap-2">
                {icon}
                {label}
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por canción o artista..."
                    className="field p-1 min-w-0 flex-1 max-w-full"
                />
            </label>

            {hasTerm && (
                <ul className="mt-2 border border-black divide-y divide-black max-h-60 overflow-y-auto" aria-busy={waiting}>
                    {waiting && visible.length === 0 && <li className="px-3 py-2 muted">Buscando...</li>}
                    {!waiting && status === "error" && <li className="px-3 py-2 muted" role="alert">No se pudo buscar. Probá de nuevo.</li>}
                    {!waiting && status === "done" && visible.length === 0 && (
                        <li className="px-3 py-2 muted">No hay canciones con ese nombre.</li>
                    )}
                    {visible.map((song) => (
                        <li key={song.id}>
                            <button
                                type="button"
                                onClick={() => pick(song)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black hover:text-white"
                            >
                                <span className="flex-1 min-w-0 break-words">
                                    {song.title}
                                    {song.artist_name && <span className="block text-xs opacity-70">{song.artist_name}</span>}
                                </span>
                                {actionIcon}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
