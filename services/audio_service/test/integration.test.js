// Ejecutar con el servicio levantado:
//   docker compose exec -T audio_service npm run test:integration
// Necesita metrics_service corriendo (crea la cola que cuenta reproducciones).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');

const cache = require('../src/cache');
const config = require('../src/config');
const storage = require('../src/storage');

const AUDIO_URL = process.env.AUDIO_URL || `http://localhost:${config.port}`;
const METRICS_URL = process.env.METRICS_URL || 'http://metrics_service:8000';
const CH = config.chunkSize;

const songId = randomUUID();
const userId = randomUUID();
const data = randomBytes(Math.floor(CH * 2.5));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stream(range, { id = songId, user = userId } = {}) {
  const headers = range ? { Range: range } : {};
  return fetch(`${AUDIO_URL}/audio/stream/${id}?user_id=${user}`, { headers });
}

async function totalPlays() {
  const response = await fetch(`${METRICS_URL}/metrics/songs/${songId}`);
  return (await response.json()).total_plays;
}

test.before(async () => {
  await cache.connect();
  if (!(await storage.client.bucketExists(config.bucket))) await storage.client.makeBucket(config.bucket);
  await storage.client.putObject(config.bucket, storage.keyFor(songId), data, data.length, {
    'Content-Type': 'audio/mpeg',
  });
});

test.after(async () => {
  await storage.client.removeObject(config.bucket, storage.keyFor(songId));
  const keys = await cache.redis.keys(`song:${songId}:*`);
  if (keys.length) await cache.redis.del(keys);
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

  const ttl = await cache.redis.ttl(cache.chunkKey(songId, 0));
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

test('errores: 416, 404 y 400', async () => {
  let response = await stream(`bytes=${data.length}-`);
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), `bytes */${data.length}`);

  response = await stream('bytes=0-', { id: randomUUID() });
  assert.equal(response.status, 404);

  response = await stream('bytes=0-', { user: 'no-es-uuid' });
  assert.equal(response.status, 400);
  response = await stream('bytes=0-', { id: 'no-es-uuid' });
  assert.equal(response.status, 400);
});

test('metricas cuenta solo las peticiones que empiezan la reproduccion', async () => {
  // Arriba hubo dos peticiones desde el byte 0; adelantar y los errores no cuentan.
  let plays = 0;
  for (let i = 0; i < 50 && plays < 2; i += 1) {
    await sleep(200);
    plays = await totalPlays();
  }
  await sleep(1000); // margen por si llega algun evento de mas
  assert.equal(await totalPlays(), 2);
});
