const express = require('express');

const auth = require('./auth');
const cache = require('./cache');
const catalog = require('./catalog');
const config = require('./config');
const events = require('./events');
const signed = require('./signed');
const storage = require('./storage');
const { parseRange, chunksFor, RangeNotSatisfiable } = require('./range');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.disable('x-powered-by');

/** Tamano y tipo del archivo: primero Redis, si no MinIO (y se cachea). */
async function getMeta(key) {
  const cached = await cache.getMeta(key);
  if (cached) return cached;
  const meta = await storage.stat(key);
  if (meta) cache.setMeta(key, meta);
  return meta;
}

/** Cache-aside por fragmento. Devuelve el buffer y si fue hit. */
async function getChunk(key, num, size) {
  const cached = await cache.getChunk(key, num);
  if (cached) return { buffer: cached, hit: true };
  const buffer = await storage.readChunk(key, num, size);
  cache.setChunk(key, num, buffer);
  return { buffer, hit: false };
}

/** La cancion tiene que existir y estar PUBLICADO. Devuelve la respuesta de error o la cancion. */
async function publishedSong(songId, res) {
  const song = await catalog.getSong(songId);
  if (!song) {
    res.status(404).json({ detail: 'Cancion no encontrada' });
    return null;
  }
  if (song.status !== 'PUBLICADO') {
    res.status(409).json({ detail: `La cancion no esta publicada (estado ${song.status})`, status: song.status });
    return null;
  }
  return song;
}

/** Usuario logueado: devuelve una URL temporal firmada para el stream. */
app.get('/audio/stream-url/:songId', async (req, res, next) => {
  const { songId } = req.params;
  if (!UUID.test(songId)) return res.status(400).json({ detail: 'song_id debe ser un UUID' });
  try {
    auth.userIdFrom(req);
  } catch (error) {
    if (!(error instanceof auth.Unauthorized)) return next(error);
    return res.status(401).json({ detail: error.message });
  }
  try {
    const song = await publishedSong(songId, res);
    if (!song) return undefined;
    const { url, expiresAt } = signed.signedUrl(songId);
    return res.json({ url, expires_at: expiresAt });
  } catch (error) {
    return next(error);
  }
});

// <audio src> no puede mandar Authorization: el permiso viaja en la URL firmada
// (?exp&sig, ver signed.js). La reproduccion se registra aparte con POST /audio/played.
app.get('/audio/stream/:songId', async (req, res, next) => {
  const { songId } = req.params;
  if (!UUID.test(songId)) return res.status(400).json({ detail: 'song_id debe ser un UUID' });

  try {
    signed.verify(songId, req.query);
  } catch (error) {
    if (!(error instanceof signed.InvalidSignature)) return next(error);
    const missing = req.query.exp === undefined && req.query.sig === undefined;
    return res.status(missing ? 401 : 403).json({ detail: error.message });
  }

  const bitrate = req.query.bitrate === undefined ? config.defaultBitrate : Number(req.query.bitrate);
  if (!config.bitrates.includes(bitrate)) {
    return res.status(400).json({ detail: `bitrate debe ser ${config.bitrates.join(' o ')}` });
  }

  try {
    const song = await publishedSong(songId, res);
    if (!song) return undefined;

    const key = catalog.keyFor(song, songId, bitrate);
    const meta = key ? await getMeta(key) : null;
    if (!meta || meta.size === 0) {
      return res.status(404).json({ detail: `No hay version de ${bitrate} kbps` });
    }

    let range;
    try {
      range = parseRange(req.get('Range'), meta.size, config.chunkSize);
    } catch (error) {
      if (!(error instanceof RangeNotSatisfiable)) throw error;
      return res.status(416).set('Content-Range', `bytes */${meta.size}`).end();
    }
    const { start, end } = range;

    const nums = chunksFor(start, end, config.chunkSize);
    const chunks = await Promise.all(nums.map((num) => getChunk(key, num, meta.size)));
    const hits = chunks.filter((c) => c.hit).length;

    // Recortar los fragmentos al rango exacto pedido.
    const offset = start - nums[0] * config.chunkSize;
    const body = Buffer.concat(chunks.map((c) => c.buffer)).subarray(offset, offset + end - start + 1);

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

/**
 * Forma de onda para la barra del reproductor: { version, points, peaks: [0..1] }.
 * La genera worker_ingesta (processed/{id}/waveform.json). Pide JWT como stream-url.
 */
app.get('/audio/waveform/:songId', async (req, res, next) => {
  const { songId } = req.params;
  if (!UUID.test(songId)) return res.status(400).json({ detail: 'song_id debe ser un UUID' });
  try {
    auth.userIdFrom(req);
  } catch (error) {
    if (!(error instanceof auth.Unauthorized)) return next(error);
    return res.status(401).json({ detail: error.message });
  }
  try {
    const song = await publishedSong(songId, res);
    if (!song) return undefined;

    const key = catalog.waveformKeyFor(song, songId);
    let waveform = await cache.getWaveform(key);
    const hit = Boolean(waveform);
    if (!waveform) {
      const raw = await storage.readSmall(key);
      if (!raw) return res.status(404).json({ detail: 'La cancion no tiene forma de onda' });
      try {
        waveform = JSON.parse(raw.toString('utf8'));
      } catch {
        waveform = null;
      }
      if (!waveform || !Array.isArray(waveform.peaks)) {
        return res.status(404).json({ detail: 'La forma de onda guardada no es valida' });
      }
      cache.setWaveform(key, waveform);
    }
    return res.set({ 'Cache-Control': 'private, max-age=3600', 'X-Cache': hit ? 'HIT' : 'MISS' }).json(waveform);
  } catch (error) {
    return next(error);
  }
});

/**
 * El front lo llama cuando la reproduccion termina o se abandona.
 * Body: { song_id, started_at, listened_sec, completed?, bitrate_kbps?, client?, room_id? }
 * user_id sale del JWT. Responde 202 cuando RabbitMQ confirmo el evento.
 */
app.post('/audio/played', express.json({ limit: '4kb' }), async (req, res, next) => {
  let userId;
  try {
    userId = auth.userIdFrom(req);
  } catch (error) {
    if (!(error instanceof auth.Unauthorized)) return next(error);
    return res.status(401).json({ detail: error.message });
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) return res.status(400).json({ detail: 'El body debe ser un objeto JSON' });
  if ('user_id' in body) return res.status(400).json({ detail: 'user_id sale del token, no del body' });

  let event;
  try {
    event = events.buildSongPlayed({ ...body, user_id: userId }, { correlationId: req.get('X-Correlation-Id') });
  } catch (error) {
    if (!(error instanceof events.InvalidEvent)) return next(error);
    return res.status(400).json({ detail: error.message, errors: error.errors });
  }

  try {
    const song = await publishedSong(body.song_id, res);
    if (!song) return undefined;
    await events.publish(event);
    console.log(`[events] ${events.TYPE} song_id=${body.song_id} listened_sec=${body.listened_sec} id=${event.id}`);
    return res.status(202).json({ id: event.id });
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
  if (error.type === 'entity.parse.failed') return res.status(400).json({ detail: 'JSON invalido' });
  if (error.type === 'entity.too.large') return res.status(413).json({ detail: 'Body demasiado grande' });
  console.error(`[audio] ${req.method} ${req.originalUrl}: ${error.stack || error}`);
  if (error instanceof catalog.CatalogUnavailable) return res.status(503).json({ detail: 'Catalogo no disponible' });
  return res.status(503).json({ detail: 'Servicio no disponible' });
});

module.exports = { app };
