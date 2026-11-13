const { randomUUID } = require('node:crypto');

const Redis = require('ioredis');

const config = require('./config');
const playback = require('./playback');

/**
 * Todo el estado de las salas vive en Redis (con appendonly: sobrevive reinicios).
 * Asi el servicio puede correr en varias copias: ninguna guarda estado propio.
 *
 *   room:{id}            JSON con nombre, visibilidad, host, etc.
 *   room:{id}:cohosts    SET de user_id coanfitriones
 *   room:{id}:playback   JSON con el estado de reproduccion (ver playback.js)
 *   room:{id}:queue      JSON: cola "a continuacion" (ver queue.js)
 *   room:{id}:suggestions JSON: canciones sugeridas por oyentes
 *   room:{id}:lock       candado para que dos comandos no se pisen (aunque vengan de otra copia)
 *   room:{id}:conns      HASH conexion → { user_id, name, instance }
 *   rooms:public         ZSET de salas publicas (por fecha de creacion)
 *                        (las privadas no tienen indice: roomIds() las encuentra con SCAN)
 *   rooms:instance:{id}  marca de vida de cada copia del servicio (TTL)
 *   canal rooms:events   pub/sub: cambios que cada copia reenvia a sus WebSockets
 */

const CHANNEL = 'rooms:events';
const PUBLIC = 'rooms:public';
const INSTANCE_TTL_SEC = 60;

const key = {
  room: (id) => `room:${id}`,
  cohosts: (id) => `room:${id}:cohosts`,
  playback: (id) => `room:${id}:playback`,
  conns: (id) => `room:${id}:conns`,
  queue: (id) => `room:${id}:queue`,
  suggestions: (id) => `room:${id}:suggestions`,
  lock: (id) => `room:${id}:lock`,
  instance: (id) => `rooms:instance:${id}`,
};
const roomKeys = (id) => [
  key.room(id), key.cohosts(id), key.playback(id), key.conns(id), key.queue(id), key.suggestions(id),
];

// Identifica a esta copia del servicio: sus conexiones mueren con ella.
const instanceId = randomUUID();

const redis = new Redis(config.redisUrl, { lazyConnect: true });
const subscriber = new Redis(config.redisUrl, { lazyConnect: true });
redis.on('error', (error) => console.warn(`[store] Redis: ${error.message}`));
subscriber.on('error', (error) => console.warn(`[store] Redis (sub): ${error.message}`));

let heartbeat = null;

async function connect() {
  await redis.connect();
  await subscriber.connect();
  const beat = () => redis.set(key.instance(instanceId), '1', 'EX', INSTANCE_TTL_SEC).catch(() => {});
  await beat();
  heartbeat = setInterval(beat, (INSTANCE_TTL_SEC / 3) * 1000);
  heartbeat.unref();
}

async function close() {
  clearInterval(heartbeat);
  await redis.del(key.instance(instanceId)).catch(() => {});
  redis.disconnect();
  subscriber.disconnect();
}

const parse = (raw) => (raw ? JSON.parse(raw) : null);

/** Renueva el vencimiento: una sala con actividad no se borra. */
async function touch(id) {
  const pipeline = redis.pipeline();
  for (const k of roomKeys(id)) pipeline.expire(k, config.roomTtlSec);
  await pipeline.exec();
}

async function createRoom(room) {
  const multi = redis.multi()
    .set(key.room(room.id), JSON.stringify(room), 'EX', config.roomTtlSec)
    .set(key.playback(room.id), JSON.stringify(playback.initial()), 'EX', config.roomTtlSec);
  if (room.visibility === 'public') multi.zadd(PUBLIC, Date.parse(room.created_at), room.id);
  await multi.exec();
}

async function deleteRoom(id) {
  await redis.multi().del(...roomKeys(id)).zrem(PUBLIC, id).exec();
}

const getRoom = async (id) => parse(await redis.get(key.room(id)));
const getPlayback = async (id) => parse(await redis.get(key.playback(id))) ?? playback.initial();
const getCohosts = (id) => redis.smembers(key.cohosts(id));

async function setPlayback(id, value) {
  await redis.set(key.playback(id), JSON.stringify(value), 'EX', config.roomTtlSec);
}

const getQueue = async (id) => parse(await redis.get(key.queue(id))) ?? [];
const getSuggestions = async (id) => parse(await redis.get(key.suggestions(id))) ?? [];

/** Guarda de una vez lo que haya cambiado: { playback?, queue?, suggestions? }. */
async function saveChanges(id, { playback: pb, queue, suggestions }) {
  const multi = redis.multi();
  if (pb) multi.set(key.playback(id), JSON.stringify(pb), 'EX', config.roomTtlSec);
  if (queue) multi.set(key.queue(id), JSON.stringify(queue), 'EX', config.roomTtlSec);
  if (suggestions) multi.set(key.suggestions(id), JSON.stringify(suggestions), 'EX', config.roomTtlSec);
  await multi.exec();
}

const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta fn con la sala bloqueada: leer estado → aplicar comando → guardar, sin que otro
 * comando (de esta u otra copia del servicio) se meta en el medio. Ej.: si dos navegadores
 * avisan "termino la cancion" a la vez, solo el primero pasa a la siguiente.
 * El candado vence solo (ttlMs) por si la copia que lo tenia se cae.
 */
async function withLock(id, fn, { ttlMs = 5000, waitMs = 3000 } = {}) {
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while (!(await redis.set(key.lock(id), token, 'PX', ttlMs, 'NX'))) {
    if (Date.now() > deadline) throw new Error(`Sala ${id} ocupada`);
    await sleep(15);
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_LOCK, 1, key.lock(id), token).catch(() => {});
  }
}

const addCohost = (id, userId) => redis.sadd(key.cohosts(id), userId).then(() => touch(id));
const removeCohost = (id, userId) => redis.srem(key.cohosts(id), userId);

async function addConn(roomId, connId, user) {
  await redis.hset(key.conns(roomId), connId, JSON.stringify({ user_id: user.id, name: user.name, instance: instanceId }));
  await touch(roomId);
}

const removeConn = (roomId, connId) => redis.hdel(key.conns(roomId), connId);

/**
 * Oyentes conectados (sin repetir usuario: alguien con dos pestanas cuenta una vez).
 * Limpia conexiones de copias del servicio que ya no estan vivas.
 */
async function listeners(roomId) {
  const conns = await redis.hgetall(key.conns(roomId));
  const entries = Object.entries(conns).map(([connId, raw]) => [connId, JSON.parse(raw)]);

  const instances = [...new Set(entries.map(([, c]) => c.instance))];
  const alive = new Set();
  if (instances.length) {
    const flags = await redis.mget(...instances.map(key.instance));
    instances.forEach((inst, i) => flags[i] && alive.add(inst));
  }

  const stale = entries.filter(([, c]) => !alive.has(c.instance)).map(([connId]) => connId);
  if (stale.length) await redis.hdel(key.conns(roomId), ...stale);

  const users = new Map();
  for (const [, c] of entries) {
    if (alive.has(c.instance)) users.set(c.user_id, { user_id: c.user_id, name: c.name });
  }
  return [...users.values()];
}

/** Salas publicas, las mas nuevas primero. Saca del indice las que ya vencieron. */
async function listPublic(limit = 50) {
  const ids = await redis.zrevrange(PUBLIC, 0, limit - 1);
  if (!ids.length) return [];
  const rooms = await redis.mget(...ids.map(key.room));
  const expired = ids.filter((_, i) => !rooms[i]);
  if (expired.length) await redis.zrem(PUBLIC, ...expired);
  return rooms.filter(Boolean).map((raw) => JSON.parse(raw));
}

/**
 * Ids de todas las salas abiertas (publicas y privadas). Recorre las claves con SCAN,
 * que no bloquea Redis aunque haya muchas. Solo lo usa song.deleted.v1 (poco frecuente).
 */
async function roomIds() {
  const ids = new Set();
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'room:*', 'COUNT', 500);
    cursor = next;
    for (const k of keys) {
      const match = /^room:([0-9a-f-]{36})$/i.exec(k);
      if (match) ids.add(match[1]);
    }
  } while (cursor !== '0');
  return [...ids];
}

/** Avisa a todas las copias del servicio (y estas a sus WebSockets). */
const publish = (roomId, payload) => redis.publish(CHANNEL, JSON.stringify({ room_id: roomId, payload }));

async function subscribe(handler) {
  await subscriber.subscribe(CHANNEL);
  subscriber.on('message', (_channel, raw) => {
    try {
      const { room_id: roomId, payload } = JSON.parse(raw);
      handler(roomId, payload);
    } catch (error) {
      console.warn(`[store] Mensaje invalido en ${CHANNEL}: ${error.message}`);
    }
  });
}

const isReady = () => redis.status === 'ready';

module.exports = {
  instanceId, connect, close, isReady,
  createRoom, deleteRoom, getRoom, getPlayback, setPlayback, getQueue, getSuggestions, saveChanges, withLock,
  getCohosts, addCohost, removeCohost,
  addConn, removeConn, listeners, listPublic, roomIds, touch, publish, subscribe,
};
