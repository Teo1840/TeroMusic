const Redis = require('ioredis');

const config = require('./config');

// Si Redis no responde, falla rapido: el audio se sirve igual desde MinIO.
const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  lazyConnect: true,
});
redis.on('error', (error) => console.warn(`[cache] Redis: ${error.message}`));

// Fragmentos y metadatos van por clave de MinIO: 128 y 320 kbps no se mezclan.
const chunkKey = (objectKey, num) => `audio:${objectKey}:chunk:${num}`;
const metaKey = (objectKey) => `audio:${objectKey}:meta`;
const songKey = (songId) => `catalog:song:${songId}`;
const waveformKey = (objectKey) => `audio:${objectKey}:waveform`;

async function connect() {
  try {
    await redis.connect();
  } catch (error) {
    // ioredis sigue reintentando en segundo plano.
    console.warn(`[cache] Redis no disponible al iniciar: ${error.message}`);
  }
}

/** Devuelve el fragmento cacheado o null (miss o Redis caido). */
async function getChunk(objectKey, num) {
  try {
    return await redis.getBuffer(chunkKey(objectKey, num));
  } catch {
    return null;
  }
}

/** Guarda el fragmento con TTL. No se espera: no debe frenar la respuesta. */
function setChunk(objectKey, num, buffer) {
  redis.set(chunkKey(objectKey, num), buffer, 'EX', config.cacheTtlSec).catch(() => {});
}

async function getJson(key) {
  try {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setJson(key, value, ttlSec) {
  redis.set(key, JSON.stringify(value), 'EX', ttlSec).catch(() => {});
}

const getMeta = (objectKey) => getJson(metaKey(objectKey));
const setMeta = (objectKey, meta) => setJson(metaKey(objectKey), meta, config.cacheTtlSec);
const getSong = (songId) => getJson(songKey(songId));
const setSong = (songId, song) => setJson(songKey(songId), song, config.catalogCacheTtlSec);
const getWaveform = (objectKey) => getJson(waveformKey(objectKey));
const setWaveform = (objectKey, waveform) => setJson(waveformKey(objectKey), waveform, config.cacheTtlSec);

function isReady() {
  return redis.status === 'ready';
}

async function close() {
  redis.disconnect();
}

module.exports = {
  redis, chunkKey, metaKey, songKey, waveformKey, connect, getChunk, setChunk, getMeta, setMeta, getSong, setSong,
  getWaveform, setWaveform, isReady, close,
};
