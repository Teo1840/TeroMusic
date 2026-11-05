const express = require('express');

const cache = require('./cache');
const config = require('./config');
const events = require('./events');
const storage = require('./storage');
const { parseRange, chunksFor, RangeNotSatisfiable } = require('./range');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.disable('x-powered-by');

/** Tamano y tipo del archivo: primero Redis, si no MinIO (y se cachea). */
async function getMeta(songId) {
  const cached = await cache.getMeta(songId);
  if (cached) return cached;
  const meta = await storage.stat(songId);
  if (meta) cache.setMeta(songId, meta);
  return meta;
}

/** Cache-aside por fragmento. Devuelve el buffer y si fue hit. */
async function getChunk(songId, num, size) {
  const cached = await cache.getChunk(songId, num);
  if (cached) return { buffer: cached, hit: true };
  const buffer = await storage.readChunk(songId, num, size);
  cache.setChunk(songId, num, buffer);
  return { buffer, hit: false };
}

/** Una reproduccion empieza en el byte 0. La sonda "bytes=0-1" de Safari no cuenta. */
function startsPlayback({ start, end }) {
  return start === 0 && end >= 2;
}

app.get('/audio/stream/:songId', async (req, res, next) => {
  const { songId } = req.params;
  // <audio src> no puede mandar headers, por eso tambien se acepta ?user_id=.
  // Cuando exista el gateway, el usuario saldra del JWT.
  const userId = req.get('X-User-Id') || req.query.user_id;

  if (!UUID.test(songId)) return res.status(400).json({ detail: 'song_id debe ser un UUID' });
  if (typeof userId !== 'string' || !UUID.test(userId)) {
    return res.status(400).json({ detail: 'Falta el usuario: header X-User-Id o ?user_id= (UUID)' });
  }

  try {
    const meta = await getMeta(songId);
    if (!meta || meta.size === 0) return res.status(404).json({ detail: 'Cancion no encontrada' });

    let range;
    try {
      range = parseRange(req.get('Range'), meta.size, config.chunkSize);
    } catch (error) {
      if (!(error instanceof RangeNotSatisfiable)) throw error;
      return res.status(416).set('Content-Range', `bytes */${meta.size}`).end();
    }
    const { start, end } = range;

    const nums = chunksFor(start, end, config.chunkSize);
    const chunks = await Promise.all(nums.map((num) => getChunk(songId, num, meta.size)));
    const hits = chunks.filter((c) => c.hit).length;

    // Recortar los fragmentos al rango exacto pedido.
    const offset = start - nums[0] * config.chunkSize;
    const body = Buffer.concat(chunks.map((c) => c.buffer)).subarray(offset, offset + end - start + 1);

    if (startsPlayback(range)) {
      events.publishSongPlayed({ songId, userId, correlationId: req.get('X-Correlation-Id') });
    }

    res.status(206).set({
      'Content-Type': meta.contentType,
      'Content-Length': String(body.length),
      'Content-Range': `bytes ${start}-${end}/${meta.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Cache': hits === chunks.length ? 'HIT' : hits === 0 ? 'MISS' : 'PARTIAL',
    });
    return res.end(body);
  } catch (error) {
    return next(error);
  }
});

app.get('/health', async (req, res) => {
  const status = { minio: 'ok', rabbitmq: events.isReady() ? 'ok' : 'down', redis: cache.isReady() ? 'ok' : 'down' };
  try {
    await storage.ping();
  } catch {
    status.minio = 'down';
  }
  // Sin Redis el servicio funciona (mas lento): queda "degraded", no caido.
  const healthy = status.minio === 'ok' && status.rabbitmq === 'ok';
  res.status(healthy ? 200 : 503).json({ status: healthy ? (status.redis === 'ok' ? 'ok' : 'degraded') : 'down', ...status });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error(`[audio] ${req.method} ${req.originalUrl}: ${error.stack || error}`);
  res.status(503).json({ detail: 'Almacenamiento no disponible' });
});

module.exports = { app, startsPlayback };
