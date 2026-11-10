// Ejecutar con el servicio levantado:
//   docker compose exec -T audio_service npm run test:integration
// Necesita metrics_service corriendo (crea la cola que cuenta reproducciones).
// No necesita una subida real: la cancion se carga en la cache del catalogo en Redis.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

const auth = require('../src/auth');
const cache = require('../src/cache');
const config = require('../src/config');
const storage = require('../src/storage');

const AUDIO_URL = process.env.AUDIO_URL || `http://localhost:${config.port}`;
const METRICS_URL = process.env.METRICS_URL || 'http://metrics_service:8000';
const CH = config.chunkSize;

const songId = randomUUID();
const userId = randomUUID();
const objectKey = `processed/${songId}/128.mp3`;
const data = randomBytes(Math.floor(CH * 2.5));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stream(range, { id = songId } = {}) {
  const headers = range ? { Range: range } : {};
  return fetch(`${AUDIO_URL}/audio/stream/${id}`, { headers });
}

function played(body) {
  return fetch(`${AUDIO_URL}/audio/played`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.sign({ sub: userId })}` },
    body: JSON.stringify(body),
  });
}

async function totalPlays() {
  const response = await fetch(`${METRICS_URL}/metrics/songs/${songId}`);
  return (await response.json()).total_plays;
}

test.before(async () => {
  await cache.connect();
  if (!(await storage.client.bucketExists(config.bucket))) await storage.client.makeBucket(config.bucket);
  await storage.client.putObject(config.bucket, objectKey, data, data.length, { 'Content-Type': 'audio/mpeg' });
  await cache.redis.set(
    cache.songKey(songId),
    JSON.stringify({
      id: songId,
      status: 'PUBLICADO',
      renditions: [{ processed_key: objectKey, codec: 'mp3', bitrate_kbps: 128, size_bytes: data.length }],
    }),
    'EX',
    300,
  );
});

test.after(async () => {
  await storage.client.removeObject(config.bucket, objectKey);
  const keys = [cache.songKey(songId), ...(await cache.redis.keys(`audio:${objectKey}:*`))];
  await cache.redis.del(keys);
  await cache.close();
});

test('primer fragmento: 206, headers correctos, MISS y luego HIT', async () => {
  let response = await stream('bytes=0-1048575');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 0-${CH - 1}/${data.length}`);
  assert.equal(response.headers.get('content-length'), String(CH));
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('x-cache'), 'MISS');
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(data.subarray(0, CH)));

  const ttl = await cache.redis.ttl(cache.chunkKey(objectKey, 0));
  assert.ok(ttl > 0 && ttl <= config.cacheTtlSec, `TTL=${ttl}`);

  response = await stream('bytes=0-');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('x-cache'), 'HIT');
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(data.subarray(0, CH)));
});

test('adelantar: rango dentro de otro fragmento y rango que cruza fragmentos', async () => {
  let response = await stream(`bytes=${CH + 100}-${CH + 199}`);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes ${CH + 100}-${CH + 199}/${data.length}`);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(data.subarray(CH + 100, CH + 200)));

  // El fragmento 1 ya quedo en cache con la peticion anterior; el 2 todavia no.
  response = await stream(`bytes=${2 * CH - 10}-${2 * CH + 9}`);
  assert.equal(response.headers.get('x-cache'), 'PARTIAL');
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(data.subarray(2 * CH - 10, 2 * CH + 10)));

  response = await stream(`bytes=${2 * CH}-`);
  assert.equal(response.headers.get('content-range'), `bytes ${2 * CH}-${data.length - 1}/${data.length}`);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(data.subarray(2 * CH)));
});

test('errores: 416, 404, 400', async () => {
  let response = await stream(`bytes=${data.length}-`);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), `bytes */${data.length}`);

  // Una cancion desconocida se consulta al catalogo: 404 si esta levantado, 503 si no.
  const catalogUp = await fetch(`${config.catalogUrl}/health`).then((r) => r.ok, () => false);
  response = await stream('bytes=0-', { id: randomUUID() });
  assert.equal(response.status, catalogUp ? 404 : 503);
  response = await stream('bytes=0-', { id: 'no-es-uuid' });
  assert.equal(response.status, 400);
});

test('metricas cuenta solo los POST /audio/played', async () => {
  // Los pedidos de stream de arriba no cuentan.
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  assert.equal((await played({ song_id: songId, started_at: startedAt, listened_sec: 12.5 })).status, 202);
  assert.equal(
    (await played({ song_id: songId, started_at: startedAt, listened_sec: 150, completed: true })).status,
    202,
  );

  let plays = 0;
  for (let i = 0; i < 50 && plays < 2; i += 1) {
    await sleep(200);
    plays = await totalPlays();
  }
  await sleep(1000); // margen por si llega algun evento de mas
  assert.equal(await totalPlays(), 2);
});
