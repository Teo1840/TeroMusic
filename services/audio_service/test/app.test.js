// Endpoints en proceso, sin Docker: catalogo, MinIO, Redis y RabbitMQ simulados.
process.env.JWT_SECRET = 'secreto-de-prueba';

const test = require('node:test');
const assert = require('node:assert/strict');

const { app } = require('../src/app');
const auth = require('../src/auth');
const cache = require('../src/cache');
const catalog = require('../src/catalog');
const events = require('../src/events');
const storage = require('../src/storage');

const SONG = 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const MISSING = 'bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const DRAFT = 'aaaaaaaa-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const USER = '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60';
const AUDIO = Buffer.from('0123456789');

const songs = {
  [SONG]: {
    status: 'PUBLICADO',
    renditions: [
      { processed_key: `processed/${SONG}/128.mp3`, bitrate_kbps: 128 },
      { processed_key: `processed/${SONG}/320.mp3`, bitrate_kbps: 320 },
    ],
  },
  [DRAFT]: { status: 'BORRADOR', renditions: null },
};
const fakeGetSong = async (id) => songs[id] ?? null;
const published = [];
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

const valid = { song_id: SONG, started_at: '2026-11-09T15:04:05Z', listened_sec: 42.5, completed: false };

test('stream: lee la rendition del catalogo segun ?bitrate', async () => {
  let response = await fetch(`${base}/audio/stream/${SONG}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-4/${AUDIO.length}`);
  assert.equal(await response.text(), '01234');

  response = await fetch(`${base}/audio/stream/${SONG}?bitrate=320`);
  assert.equal(response.status, 206);
  await response.arrayBuffer();
  assert.deepEqual(reads, [`processed/${SONG}/128.mp3`, `processed/${SONG}/320.mp3`]);

  assert.equal((await fetch(`${base}/audio/stream/${SONG}?bitrate=64`)).status, 400);
});

test('stream: pedir audio ya no publica song.played', async () => {
  published.length = 0;
  await (await fetch(`${base}/audio/stream/${SONG}`, { headers: { Range: 'bytes=0-' } })).arrayBuffer();
  assert.equal(published.length, 0);
});

test('stream: 404 si no existe, 409 si no esta PUBLICADO', async () => {
  assert.equal((await fetch(`${base}/audio/stream/${MISSING}`)).status, 404);
  const response = await fetch(`${base}/audio/stream/${DRAFT}`);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'BORRADOR');
});

test('played: publica el evento con el user_id del JWT', async () => {
  published.length = 0;
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

test('played: 404 si no existe y 409 si no esta publicada', async () => {
  assert.equal((await played({ ...valid, song_id: MISSING })).status, 404);
  assert.equal((await played({ ...valid, song_id: DRAFT })).status, 409);
});

test('catalogo caido: 503', async () => {
  catalog.getSong = async () => {
    throw new catalog.CatalogUnavailable('caido');
  };
  try {
    assert.equal((await fetch(`${base}/audio/stream/${SONG}`)).status, 503);
    assert.equal((await played(valid)).status, 503);
  } finally {
    catalog.getSong = fakeGetSong;
  }
});
