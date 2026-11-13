/**
 * Órdenes posibles del catálogo (los aplica el server: GET /songs?sort=).
 * El primero es el que se usa por defecto.
 */
export const SORTS = [
    { id: "title", label: "Título (A-Z)" },
    { id: "artist", label: "Artista (A-Z)" },
    { id: "newest", label: "Más nuevas" },
    { id: "longest", label: "Más largas" },
    { id: "shortest", label: "Más cortas" }
];

/** "1 canción" / "3 canciones". */
export function songCount(n) {
    return n === 1 ? "1 canción" : `${n} canciones`;
}
