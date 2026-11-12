import { useState } from "react";
import { filterByTitle, normalize } from "../lib/format";

const MAX_RESULTS = 10;

/**
 * Buscador de canciones: no muestra el catálogo entero, solo las que coinciden con lo escrito.
 * Al elegir una llama a onPick(song) y se limpia.
 */
export default function SongSearch({ songs, label, icon, actionIcon, onPick }) {
    const [search, setSearch] = useState("");
    const hasTerm = normalize(search) !== "";
    const results = hasTerm ? filterByTitle(songs, search).slice(0, MAX_RESULTS) : [];

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
                    placeholder="Buscar por nombre..."
                    className="field p-1 min-w-0 flex-1 max-w-full"
                />
            </label>

            {hasTerm && (
                <ul className="mt-2 border border-black divide-y divide-black max-h-60 overflow-y-auto">
                    {results.length === 0 && (
                        <li className="px-3 py-2 muted">No hay canciones con ese nombre.</li>
                    )}
                    {results.map((song) => (
                        <li key={song.id}>
                            <button
                                type="button"
                                onClick={() => pick(song)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black hover:text-white"
                            >
                                <span className="flex-1 min-w-0 break-words">{song.title}</span>
                                {actionIcon}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
