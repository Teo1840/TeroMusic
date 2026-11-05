const Redis = require('ioredis');

const config = require('./config');

// Si Redis no responde, falla rapido: el audio se sirve igual desde MinIO.
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
});
redis.on('error', (error) => console.warn(`[cache] Redis: ${error.message}`));

const chunkKey = (songId, num) => `song:${songId}:chunk:${num}`;
const metaKey = (songId) => `song:${songId}:meta`;

async function connect() {
  try {
    await redis.connect();
  } catch (error) {
    // ioredis sigue reintentando en segundo plano.
    console.warn(`[cache] Redis no disponible al iniciar: ${error.message}`);
  }
}

/** Devuelve el fragmento cacheado o null (miss o Redis caido). */
async function getChunk(songId, num) {
  try {
    return await redis.getBuffer(chunkKey(songId, num));
  } catch {
    return null;
  }
}

/** Guarda el fragmento con TTL. No se espera: no debe frenar la respuesta. */
function setChunk(songId, num, buffer) {
  redis.set(chunkKey(songId, num), buffer, 'EX', config.cacheTtlSec).catch(() => {});
}

async function getMeta(songId) {
  try {
    const raw = await redis.get(metaKey(songId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setMeta(songId, meta) {
  redis.set(metaKey(songId), JSON.stringify(meta), 'EX', config.cacheTtlSec).catch(() => {});
}

function isReady() {
  return redis.status === 'ready';
}

async function close() {
  redis.disconnect();
}

module.exports = { redis, chunkKey, metaKey, connect, getChunk, setChunk, getMeta, setMeta, isReady, close };
