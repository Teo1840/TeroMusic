const cache = require('./cache');
const config = require('./config');

class CatalogUnavailable extends Error {}

/**
 * Cancion segun catalog_service ({ status, renditions, ... }) o null si no existe.
 * Solo se cachean las PUBLICADO: una BORRADOR puede publicarse en cualquier momento.
 */
async function getSong(songId) {
  const cached = await cache.getSong(songId);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(`${config.catalogUrl}/songs/${songId}`, {
      signal: AbortSignal.timeout(config.catalogTimeoutMs),
    });
  } catch (error) {
    throw new CatalogUnavailable(`catalog_service no responde: ${error.message}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new CatalogUnavailable(`catalog_service respondio ${response.status}`);

  const song = await response.json();
  if (song.status === 'PUBLICADO') cache.setSong(songId, song);
  return song;
}

/** Clave en MinIO de la version pedida, o null si esa calidad no existe. */
function keyFor(song, songId, bitrate) {
  const renditions = Array.isArray(song.renditions) ? song.renditions : [];
  if (renditions.length === 0) {
    return config.keyTemplate.replaceAll('{song_id}', songId).replaceAll('{bitrate}', String(bitrate));
  }
  const rendition = renditions.find((r) => Number(r.bitrate_kbps) === bitrate);
  return rendition?.processed_key || null;
}

/** Clave en MinIO del waveform.json: el worker lo deja en la misma carpeta que los MP3. */
function waveformKeyFor(song, songId) {
  const renditions = Array.isArray(song.renditions) ? song.renditions : [];
  const first = renditions.find((r) => typeof r.processed_key === 'string');
  if (first) return `${first.processed_key.slice(0, first.processed_key.lastIndexOf('/') + 1)}waveform.json`;
  return config.keyTemplate.replaceAll('{song_id}', songId).replace(/[^/]*$/, 'waveform.json');
}

module.exports = { CatalogUnavailable, getSong, keyFor, waveformKeyFor };
