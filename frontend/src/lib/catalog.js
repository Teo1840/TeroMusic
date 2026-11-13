import { artistLabel } from "./format";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Órdenes posibles del catálogo. El primero es el que se usa por defecto. */
export const SORTS = [
    { id: "title", label: "Título (A-Z)" },
    { id: "artist", label: "Artista (A-Z)" },
    { id: "longest", label: "Más largas" },
    { id: "shortest", label: "Más cortas" }
];

const byTitle = (a, b) => collator.compare(a.title ?? "", b.title ?? "");
const duration = (song) => (Number.isFinite(song.duration) ? song.duration : null);

/** Copia ordenada de las canciones. Las que no tienen duración van al final en los órdenes por duración. */
export function sortSongs(songs, sort) {
    const list = [...songs];
    switch (sort) {
        case "artist":
            return list.sort((a, b) => collator.compare(artistLabel(a), artistLabel(b)) || byTitle(a, b));
        case "longest":
        case "shortest": {
            const sign = sort === "longest" ? -1 : 1;
            return list.sort((a, b) => {
                const da = duration(a);
                const db = duration(b);
                if (da === null || db === null) return (da === null) - (db === null) || byTitle(a, b);
                return sign * (da - db) || byTitle(a, b);
            });
        }
        default:
            return list.sort(byTitle);
    }
}

/** Artistas del catálogo con cuántas canciones tiene cada uno, ordenados por nombre. */
export function artistsOf(songs) {
    const map = new Map();
    for (const song of songs) {
        const id = song.artist_id ?? "";
        const entry = map.get(id) ?? { id, name: artistLabel(song), count: 0 };
        entry.count += 1;
        map.set(id, entry);
    }
    return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/** "1 canción" / "3 canciones". */
export function songCount(n) {
    return n === 1 ? "1 canción" : `${n} canciones`;
}
