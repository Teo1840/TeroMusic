// API REST en proceso, sin Docker: Redis y RabbitMQ simulados.
process.env.JWT_SECRET = 'secreto-de-prueba';

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../src/auth');
const events = require('../src/events');
const { createApp } = require('../src/app');
const pb = require('../src/playback');

const HOST = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';

/** Store en memoria con la misma interfaz que src/store.js. */
function memoryStore() {
  const rooms = new Map();
  const playbacks = new Map();
  const published = [];
  return {
    rooms,
    published,
    isReady: () => true,
    createRoom: async (room) => {
      rooms.set(room.id, room);
      playbacks.set(room.id, pb.initial());
    },
    deleteRoom: async (id) => {
      rooms.delete(id);
    },
    getRoom: async (id) => rooms.get(id) ?? null,
    getPlayback: async (id) => playbacks.get(id) ?? pb.initial(),
    getCohosts: async () => [],
    listeners: async () => [{ user_id: HOST, name: 'ana' }],
    listPublic: async () => [...rooms.values()].filter((r) => r.visibility === 'public'),
    publish: async (roomId, payload) => published.push({ roomId, payload }),
  };
}

const sentEvents = [];
const fakeEvents = {
  isReady: () => true,
  buildRoomCreated: events.buildRoomCreated, // valida contra el contrato real
  publish: async (event) => sentEvents.push(event),
};

let server;
let base;
let store;

test.before(async () => {
  store = memoryStore();
  server = createApp({ store, events: fakeEvents }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const tokenFor = (sub, email = 'ana@example.com') => auth.sign({ sub, email });

function call(method, path, { body, user = HOST } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${tokenFor(user)}`;
  return fetch(`${base}${path}`, { method, headers, body: body && JSON.stringify(body) });
}

test('crear sala: 201, el creador es el anfitrion y se publica room.created', async () => {
  sentEvents.length = 0;
  const response = await call('POST', '/rooms', { body: { name: '  Viernes  ', max_listeners: 10 } });
  assert.equal(response.status, 201);
  const room = await response.json();
  assert.equal(room.name, 'Viernes');
  assert.equal(room.visibility, 'public');
  assert.equal(room.host_id, HOST);
  assert.equal(room.host_name, 'ana');
  assert.deepEqual(room.cohosts, []);

  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].type, 'room.created.v1');
  assert.equal(sentEvents[0].source, '/services/rooms');
  assert.deepEqual(sentEvents[0].data, {
    room_id: room.id, host_id: HOST, name: 'Viernes', visibility: 'public', max_listeners: 10,
  });
});

test('crear sala: 400 si los datos no son validos, 401 sin login', async () => {
  for (const body of [{}, { name: '' }, { name: 'x'.repeat(81) }, { name: 'a', visibility: 'secreta' },
    { name: 'a', max_listeners: 1 }, { name: 'a', max_listeners: 501 }, { name: 'a', max_listeners: 2.5 }]) {
    assert.equal((await call('POST', '/rooms', { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', '/rooms', { body: { name: 'a' }, user: null })).status, 401);
});

test('listar: solo salas publicas, con oyentes y que suena', async () => {
  await call('POST', '/rooms', { body: { name: 'Privada', visibility: 'private' } });
  const response = await call('GET', '/rooms');
  assert.equal(response.status, 200);
  const rooms = await response.json();
  assert.ok(rooms.length >= 1);
  assert.ok(rooms.every((r) => r.visibility === 'public'));
  assert.equal(rooms[0].listeners, 1);
  assert.equal(rooms[0].now_playing, null);
});

test('ver sala: estado completo (privadas tambien), 404 y 400', async () => {
  const created = await (await call('POST', '/rooms', { body: { name: 'Link', visibility: 'private' } })).json();
  const response = await call('GET', `/rooms/${created.id}`, { user: OTHER });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.room.name, 'Link');
  assert.deepEqual(state.room.cohosts, []);
  assert.equal(state.playback.song_id, null);
  assert.equal(typeof state.server_time, 'number');

  assert.equal((await call('GET', '/rooms/bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f')).status, 404);
  assert.equal((await call('GET', '/rooms/no-es-uuid')).status, 400);
});

test('cerrar sala: solo el anfitrion; avisa a los conectados', async () => {
  const created = await (await call('POST', '/rooms', { body: { name: 'Cerrar' } })).json();
  assert.equal((await call('DELETE', `/rooms/${created.id}`, { user: OTHER })).status, 403);

  store.published.length = 0;
  assert.equal((await call('DELETE', `/rooms/${created.id}`)).status, 204);
  assert.deepEqual(store.published, [{ roomId: created.id, payload: { type: 'closed' } }]);
  assert.equal((await call('GET', `/rooms/${created.id}`)).status, 404);
});
