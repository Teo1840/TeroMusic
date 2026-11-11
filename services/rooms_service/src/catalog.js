const config = require('./config');

class CatalogUnavailable extends Error {}

/** Cancion segun catalog_service ({ title, status, duration, ... }) o null si no existe. */
async function getSong(songId) {
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
  return response.json();
}

module.exports = { CatalogUnavailable, getSong };
