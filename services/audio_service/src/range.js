// Limite para un rango explicito muy grande (bytes=0-999999999): se recorta.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

class RangeNotSatisfiable extends Error {}

/**
 * Convierte el header Range en { start, end } (inclusivos).
 *
 * - Sin header se trata como "bytes=0-".
 * - "bytes=a-" (abierto) termina al final del fragmento que contiene a,
 *   asi cada respuesta corresponde a una sola clave de cache.
 * - "bytes=a-b" respeta b, con un tope de MAX_RESPONSE_BYTES.
 * - "bytes=-n" son los ultimos n bytes.
 * Lanza RangeNotSatisfiable si el rango no cae dentro del archivo.
 */
function parseRange(header, size, chunkSize) {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header || 'bytes=0-').trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    // Rangos multiples o mal formados: se sirve el primer fragmento.
    return parseRange('bytes=0-', size, chunkSize);
  }

  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) throw new RangeNotSatisfiable();
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    if (match[2] === '') {
      end = (Math.floor(start / chunkSize) + 1) * chunkSize - 1;
    } else {
      end = Number(match[2]);
    }
  }

  if (start >= size || start > end) throw new RangeNotSatisfiable();
  end = Math.min(end, size - 1, start + MAX_RESPONSE_BYTES - 1);
  return { start, end };
}

/** Numeros de fragmento que cubren [start, end]. */
function chunksFor(start, end, chunkSize) {
  const first = Math.floor(start / chunkSize);
  const last = Math.floor(end / chunkSize);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

module.exports = { parseRange, chunksFor, RangeNotSatisfiable, MAX_RESPONSE_BYTES };
