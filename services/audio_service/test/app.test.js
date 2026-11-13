// Endpoints en proceso, sin Docker: catalogo, MinIO, Redis y RabbitMQ simulados.
process.env.JWT_SECRET = 'secreto-de-prueba';

const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/app');
const auth = require('../src/auth');
const cache = require('../src/cache');
const catalog = require('../src/catalog');
const events = require('../src/events');
const plays = require('../src/plays');
const signed = require('../src/signed');
const storage = require('../src/storage');

const SONG = 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const MISSING = 'bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const DRAFT = 'aaaaaaaa-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const USER = '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60';
const AUDIO = Buffer.from('0123456789');

const songs = {
  [SONG]: {
    status: 'PUBLICADO',
    duration: 180,
    renditions: [
      { processed_key: `processed/${SONG}/128.mp3`, bitrate_kbps: 128 },
      { processed_key: `processed/${SONG}/320.mp3`, bitrate_kbps: 320 },
    ],
  },
  [DRAFT]: { status: 'BORRADOR', renditions: null },
};
const fakeGetSong = async (id) => songs[id] ?? null;
const published = [];
const timeline = new Map();
const reads = [];

let server;
let base;

test.before(async () => {
  cache.getMeta = async () => null;
  cache.getChunk = async () => null;
  cache.setMeta = () => {};
  cache.setChunk = () => {};
  storage.stat = async () => ({ size: AUDIO.length, contentType: 'audio/mpeg' });
  storage.readChunk = async (key) => {
    reads.push(key);
    return AUDIO;
  };
  catalog.getSong = fakeGetSong;
  events.publish = async (event) => {
    published.push(event);
  };
  // Sin Redis en los tests: la linea de tiempo de cada usuario vive en memoria.
  plays.claim = async (userId, startedMs, endMs) => {
    const last = timeline.get(userId) ?? 0;
    if (startedMs + 2000 < last) return false;
    timeline.set(userId, endMs);
    return true;
  };

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

function played(body, { authorization = `Bearer ${auth.sign({ sub: USER })}` } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  return fetch(`${base}/audio/played`, { method: 'POST', headers, body: JSON.stringify(body) });
}

/** URL del stream con firma valida (como la que entrega /audio/stream-url). */
function streamUrl(id, extra = '') {
  const query = signed.signedUrl(id).url.split('?')[1];
  return `${base}/audio/stream/${id}?${query}${extra}`;
}

// Hace 5 minutos (sin milisegundos, como el contrato).
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, 'Z');
const valid = { song_id: SONG, started_at: isoAgo(5 * 60 * 1000), listened_sec: 42.5, completed: false };

test('stream: lee la rendition del catalogo segun ?bitrate', async () => {
  let response = await fetch(streamUrl(SONG), { headers: { Range: 'bytes=0-4' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-4/${AUDIO.length}`);
  assert.equal(await response.text(), '01234');

  response = await fetch(streamUrl(SONG, '&bitrate=320'));
  assert.equal(response.status, 206);
  await response.arrayBuffer();
  assert.deepEqual(reads, [`processed/${SONG}/128.mp3`, `processed/${SONG}/320.mp3`]);

  assert.equal((await fetch(streamUrl(SONG, '&bitrate=64'))).status, 400);
});

test('stream: pedir audio ya no publica song.played', async () => {
  published.length = 0;
  await (await fetch(streamUrl(SONG), { headers: { Range: 'bytes=0-' } })).arrayBuffer();
  assert.equal(published.length, 0);
});

test('stream: 404 si no existe, 409 si no esta PUBLICADO', async () => {
  assert.equal((await fetch(streamUrl(MISSING))).status, 404);
  const response = await fetch(streamUrl(DRAFT));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'BORRADOR');
});

test('stream: 401 sin firma, 403 con firma invalida, vencida o de otra cancion', async () => {
  assert.equal((await fetch(`${base}/audio/stream/${SONG}`)).status, 401);

  const query = signed.signedUrl(SONG).url.split('?')[1];
  assert.equal((await fetch(`${base}/audio/stream/${SONG}?${query}x`)).status, 403);
  assert.equal((await fetch(`${base}/audio/stream/${DRAFT}?${query}`)).status, 403);

  const expired = signed.signedUrl(SONG, { now: Date.now() - 2 * 3600 * 1000 }).url.split('?')[1];
  assert.equal((await fetch(`${base}/audio/stream/${SONG}?${expired}`)).status, 403);
});

test('stream-url: con login devuelve una URL firmada que funciona', async () => {
  const headers = { Authorization: `Bearer ${auth.sign({ sub: USER })}` };
  const response = await fetch(`${base}/audio/stream-url/${SONG}`, { headers });
  assert.equal(response.status, 200);
  const { url, expires_at: expiresAt } = await response.json();
  assert.ok(url.startsWith(`/api/v1/audio/stream/${SONG}?exp=`), url);
  assert.match(url, /\?exp=\d+&sig=[\w-]+$/);
  assert.ok(new Date(expiresAt) > new Date());

  const stream = await fetch(`${base}/audio/stream/${SONG}?${url.split('?')[1]}`, { headers: { Range: 'bytes=0-1' } });
  assert.equal(stream.status, 206);
  await stream.arrayBuffer();
});

test('stream-url: 401 sin login, 404/409 si la cancion no se puede escuchar', async () => {
  assert.equal((await fetch(`${base}/audio/stream-url/${SONG}`)).status, 401);
  const headers = { Authorization: `Bearer ${auth.sign({ sub: USER })}` };
  assert.equal((await fetch(`${base}/audio/stream-url/${MISSING}`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/audio/stream-url/${DRAFT}`, { headers })).status, 409);
});

test('played: publica el evento con el user_id del JWT', async () => {
  published.length = 0;
  timeline.clear();
  const response = await played(valid);
  assert.equal(response.status, 202);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].data, { ...valid, user_id: USER });
  assert.equal((await response.json()).id, published[0].id);
});

test('played: 401 sin token o con token invalido', async () => {
  assert.equal((await played(valid, { authorization: null })).status, 401);
  assert.equal((await played(valid, { authorization: 'Bearer x.y.z' })).status, 401);
  assert.equal((await played(valid, { authorization: `Bearer ${auth.sign({ sub: USER }, 'otro')}` })).status, 401);
});

test('played: 400 si el body no cumple el contrato', async () => {
  published.length = 0;
  for (const body of [
    { ...valid, started_at: undefined },
    { ...valid, listened_sec: undefined },
    { ...valid, started_at: '2026-11-09 15:04:05' },
    { ...valid, user_id: USER },
    { ...valid, otro: true },
  ]) {
    assert.equal((await played(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(published.length, 0);
});

test('played: tiempos imposibles dan 400 y no publican', async () => {
  published.length = 0;
  timeline.clear();
  for (const body of [
    { ...valid, started_at: isoAgo(-10 * 60 * 1000) }, // en el futuro
    { ...valid, started_at: isoAgo(2 * 24 * 60 * 60 * 1000) }, // de hace dos dias
    { ...valid, started_at: isoAgo(10 * 1000), listened_sec: 120 }, // mas de lo que paso
    { ...valid, started_at: isoAgo(60 * 60 * 1000), listened_sec: 600 }, // mas que la cancion
  ]) {
    assert.equal((await played(body)).status, 400, JSON.stringify(body));
  }
  assert.equal(published.length, 0);
});

test('played: menos del minimo se acepta pero no cuenta', async () => {
  published.length = 0;
  timeline.clear();
  const response = await played({ ...valid, listened_sec: 10 });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { counted: false, reason: 'too_short' });
  assert.equal(published.length, 0);
});

test('played: repetir el pedido o superponer reproducciones no infla el contador', async () => {
  published.length = 0;
  timeline.clear();
  assert.equal((await played(valid)).status, 202);
  const again = await played(valid);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { counted: false, reason: 'overlap' });
  // Empieza 10 s despues de la anterior, que duro 42.5 s: se superpone.
  const overlapping = { ...valid, started_at: new Date(Date.parse(valid.started_at) + 10000).toISOString().replace(/\.\d+Z$/, 'Z') };
  assert.equal((await played(overlapping)).status, 200);
  // Empieza cuando termino la anterior: cuenta.
  const after = { ...valid, started_at: new Date(Date.parse(valid.started_at) + 60000).toISOString().replace(/\.\d+Z$/, 'Z') };
  assert.equal((await played(after)).status, 202);
  assert.equal(published.length, 2);
});

test('played: 404 si no existe y 409 si no esta publicada', async () => {
  assert.equal((await played({ ...valid, song_id: MISSING })).status, 404);
  assert.equal((await played({ ...valid, song_id: DRAFT })).status, 409);
});

test('catalogo caido: 503', async () => {
  timeline.clear();
  catalog.getSong = async () => {
    throw new catalog.CatalogUnavailable('caido');
  };
  try {
    assert.equal((await fetch(streamUrl(SONG))).status, 503);
    assert.equal((await played(valid)).status, 503);
  } finally {
    catalog.getSong = fakeGetSong;
  }
});

test('waveform: con login devuelve los picos de la carpeta de la cancion', async () => {
  const WAVE = { version: 1, points: 3, peaks: [0.1, 0.5, 1] };
  const saved = [];
  const original = { readSmall: storage.readSmall, getWaveform: cache.getWaveform, setWaveform: cache.setWaveform };
  storage.readSmall = async (key) => (key === `processed/${SONG}/waveform.json` ? Buffer.from(JSON.stringify(WAVE)) : null);
  cache.getWaveform = async () => null;
  cache.setWaveform = (key, value) => saved.push([key, value]);
  try {
    const headers = { Authorization: `Bearer ${auth.sign({ sub: USER })}` };
    const response = await fetch(`${base}/audio/waveform/${SONG}`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cache'), 'MISS');
    assert.deepEqual(await response.json(), WAVE);
    assert.deepEqual(saved, [[`processed/${SONG}/waveform.json`, WAVE]]);

    cache.getWaveform = async () => WAVE;
    const again = await fetch(`${base}/audio/waveform/${SONG}`, { headers });
    assert.equal(again.headers.get('x-cache'), 'HIT');
  } finally {
    Object.assign(storage, { readSmall: original.readSmall });
    Object.assign(cache, { getWaveform: original.getWaveform, setWaveform: original.setWaveform });
  }
});

test('waveform: 401 sin login, 404 si no existe el archivo o la cancion, 409 si no esta publicada', async () => {
  const original = { readSmall: storage.readSmall, getWaveform: cache.getWaveform };
  storage.readSmall = async () => null;
  cache.getWaveform = async () => null;
  try {
    const headers = { Authorization: `Bearer ${auth.sign({ sub: USER })}` };
    assert.equal((await fetch(`${base}/audio/waveform/${SONG}`)).status, 401);
    assert.equal((await fetch(`${base}/audio/waveform/${SONG}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/audio/waveform/${MISSING}`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/audio/waveform/${DRAFT}`, { headers })).status, 409);
    assert.equal((await fetch(`${base}/audio/waveform/no-es-uuid`, { headers })).status, 400);
  } finally {
    storage.readSmall = original.readSmall;
    cache.getWaveform = original.getWaveform;
  }
});
