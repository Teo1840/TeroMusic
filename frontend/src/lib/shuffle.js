/**
 * Copia mezclada de `list` (Fisher–Yates). Si viene `firstId`, esa canción queda primera
 * y se mezcla el resto: así la que está sonando no se mueve al prender el aleatorio.
 */
export function shuffled(list, firstId = null) {
    const first = firstId ? list.find((item) => item.id === firstId) : null;
    const rest = first ? list.filter((item) => item !== first) : [...list];
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return first ? [first, ...rest] : rest;
}

/** Elige al azar un elemento de `list`, o null si está vacía. */
export function pickRandom(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
