/** Segundos → "m:ss". */
export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Minúsculas y sin tildes, para que "cancion" encuentre "Canción". */
export function normalize(text) {
    return (text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Canciones cuyo título (o artista, si lo tienen) contiene lo buscado. */
export function filterByTitle(songs, query) {
    const term = normalize(query);
    return term
        ? songs.filter((song) => normalize(song.title).includes(term) || normalize(song.artist_name).includes(term))
        : songs;
}

/** Nombre del artista para mostrar. null si catálogo todavía no recibió su perfil. */
export function artistLabel(song) {
    return song.artist_name || "Artista desconocido";
}

/** "Ana María López" → "AL"; "teo" → "T". Para el avatar del perfil. */
export function initials(name) {
    const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const first = [...words[0]][0];
    const last = words.length > 1 ? [...words[words.length - 1]][0] : "";
    return (first + last).toUpperCase();
}

/** Fecha ISO → "noviembre de 2026". "" si no es una fecha válida. */
export function formatMonthYear(iso) {
    // Sin el chequeo, new Date(null) es 1970 y se mostraría "diciembre de 1969".
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(date);
}

/** Fecha ISO → "13 de noviembre de 2026". "" si no es una fecha válida. */
export function formatDate(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

// Mensajes del backend que el usuario ve seguido, en castellano.
const STATUS_MESSAGES = {
    429: "Demasiados intentos seguidos. Esperá un minuto y probá de nuevo."
};

/**
 * Texto para mostrar a partir de un error de axios.
 * FastAPI devuelve `detail` como texto o, si falla la validación (422), como lista.
 */
export function errorMessage(err, fallback) {
    const status = err?.response?.status;
    if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];

    const detail = err?.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    return fallback;
}
