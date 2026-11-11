import { useState } from "react";

// Minúsculas y sin tildes, para que "cancion" encuentre "Canción".
function normalize(text) {
    return (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const MAX_RESULTS = 10;

/**
 * Buscador de canciones: no muestra el catálogo entero, solo las que coinciden con lo escrito.
 * Al elegir una llama a onPick(song) y se limpia.
 */
export default function SongSearch({ songs, label, icon, actionIcon, onPick }) {
    const [search, setSearch] = useState("");
    const term = normalize(search);
    const results = term
        ? songs.filter((song) => normalize(song.title).includes(term)).slice(0, MAX_RESULTS)
        : [];

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
                    className="border p-1 min-w-0 flex-1 max-w-full"
                />
            </label>

            {term && (
                <ul className="mt-2 border rounded divide-y max-h-60 overflow-y-auto">
                    {results.length === 0 && (
                        <li className="px-3 py-2 text-gray-500">No hay canciones con ese nombre.</li>
                    )}
                    {results.map((song) => (
                        <li key={song.id}>
                            <button
                                type="button"
                                onClick={() => pick(song)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
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
