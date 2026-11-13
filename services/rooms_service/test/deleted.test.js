// song.deleted.v1: la cancion borrada sale de las salas. Sin Redis ni RabbitMQ.
const test = require('node:test');
const assert = require('node:assert/strict');

const commands = require('../src/commands');
const { removeDeletedSong } = require('../src/deleted');
const events = require('../src/events');
const pb = require('../src/playback');
const queue = require('../src/queue');

const HOST = { id: '11111111-1111-4111-8111-111111111111', name: 'ana' };
const LISTENER = { id: '33333333-3333-4333-8333-333333333333', name: 'lu' };
const ARTIST = '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60';
const SONGS = {
  'a0000000-0000-4000-8000-000000000001': { title: 'Uno', status: 'PUBLICADO', duration: 100, artist_id: ARTIST, artist_name: 'Los Teros' },
  'a0000000-0000-4000-8000-000000000002': { title: 'Dos', status: 'PUBLICADO', duration: 200, artist_id: ARTIST, artist_name: 'Los Teros' },
  'a0000000-0000-4000-8000-000000000003': { title: 'Tres', status: 'PUBLICADO', duration: 300, artist_id: null, artist_name: null },
};
const [S1, S2, S3] = Object.keys(SONGS);
const DELAY = 1_500;

/** Store en memoria con lo que usa removeDeletedSong. */
function memoryStore() {
  const rooms = new Map();
  const locks = [];
  return {
    rooms,
    locks,
    add(id, state) {
      rooms.set(id, { room: { id, host_id: HOST.id }, playback: pb.initial(), queue: [], suggestions: [], ...state });
    },
    roomIds: async () => [...rooms.keys()],
    withLock: async (id, fn) => {
      locks.push(id);
      return fn();
    },
    getRoom: async (id) => rooms.get(id)?.room ?? null,
    getPlayback: async (id) => rooms.get(id).playback,
    getQueue: async (id) => rooms.get(id).queue,
    getSuggestions: async (id) => rooms.get(id).suggestions,
    saveChanges: async (id, change) => {
      const r = rooms.get(id);
      for (const k of ['playback', 'queue', 'suggestions']) if (change[k]) r[k] = change[k];
    },
  };
}

/** Arma el estado de una sala con comandos reales (asi los items son como los de produccion). */
async function buildRoom(steps) {
  const state = { playback: pb.initial(), queue: [], suggestions: [] };
  for (const [user, message] of steps) {
    // eslint-disable-next-line no-await-in-loop
    const change = await commands.apply(message, {
      room: { id: 'r', host_id: HOST.id }, cohosts: [], user, now: 10_000, startDelayMs: DELAY,
      ...state, getSong: async (id) => SONGS[id] ?? null,
    });
    Object.assign(state, change);
  }
  return state;
}

const titles = (list) => list.map((item) => item.title);

test('la cola y lo que suena traen el artista', async () => {
  const s = await buildRoom([
    [HOST, { type: 'queue_add', song_id: S1 }],
    [HOST, { type: 'queue_add', song_id: S3 }],
  ]);
  assert.equal(s.playback.artist_name, 'Los Teros');
  assert.equal(s.playback.artist_id, ARTIST);
  assert.equal(s.queue[0].artist_name, null); // catalogo todavia sin perfil: null, no undefined
  const next = queue.advance([queue.makeItem({ id: S2, ...SONGS[S2] }, HOST)], 0, 0);
  assert.equal(next.playback.artist_name, 'Los Teros');
});

test('dropSong: saca de la cola y de las sugerencias (todas las copias)', async () => {
  const s = await buildRoom([
    [HOST, { type: 'queue_add', song_id: S1 }],
    [HOST, { type: 'queue_add', song_id: S2 }],
    [HOST, { type: 'queue_add', song_id: S3 }],
    [HOST, { type: 'queue_add', song_id: S2 }],
  ]);
  s.suggestions = [queue.makeItem({ id: S2, ...SONGS[S2] }, LISTENER)];

  const change = queue.dropSong(s, S2, 20_000, DELAY);
  assert.deepEqual(titles(change.queue), ['Tres']);
  assert.deepEqual(change.suggestions, []);
  assert.equal(change.playback, undefined); // la que suena (Uno) sigue
});

test('dropSong: si suena la borrada pasa a la siguiente; sin cola, la sala queda sin cancion', async () => {
  const s = await buildRoom([
    [HOST, { type: 'queue_add', song_id: S1 }],
    [HOST, { type: 'queue_add', song_id: S2 }],
  ]);
  const change = queue.dropSong(s, S1, 20_000, DELAY);
  assert.equal(change.playback.song_id, S2);
  assert.equal(change.playback.updated_at_ms, 20_000 + DELAY);
  assert.deepEqual(change.queue, []);

  const alone = await buildRoom([[HOST, { type: 'queue_add', song_id: S1 }]]);
  assert.deepEqual(queue.dropSong(alone, S1, 20_000, DELAY), { playback: pb.initial() });
});

test('dropSong: si la sala no tenia la cancion no cambia nada', async () => {
  const s = await buildRoom([[HOST, { type: 'queue_add', song_id: S1 }]]);
  assert.deepEqual(queue.dropSong(s, S3, 20_000, DELAY), {});
});

test('removeDeletedSong: cambia solo las salas afectadas y les avisa', async () => {
  const store = memoryStore();
  store.add('con', await buildRoom([
    [HOST, { type: 'queue_add', song_id: S1 }],
    [HOST, { type: 'queue_add', song_id: S2 }],
  ]));
  store.add('sin', await buildRoom([[HOST, { type: 'queue_add', song_id: S3 }]]));
  const avisadas = [];
  const opts = { store, broadcastState: async (id) => avisadas.push(id), now: () => 30_000, startDelayMs: DELAY };

  assert.equal(await removeDeletedSong(S2, opts), 1);
  assert.deepEqual(avisadas, ['con']);
  assert.deepEqual(store.rooms.get('con').queue, []);
  assert.equal(store.rooms.get('con').playback.song_id, S1);
  assert.deepEqual(store.locks.sort(), ['con', 'sin']); // cada sala con su candado

  // Repetido (RabbitMQ entrega al menos una vez): no hace nada.
  assert.equal(await removeDeletedSong(S2, opts), 0);
  assert.deepEqual(avisadas, ['con']);
});

test('removeDeletedSong: ignora salas que vencieron mientras tanto', async () => {
  const store = memoryStore();
  store.add('vieja', {});
  store.rooms.get('vieja').room = null;
  assert.equal(await removeDeletedSong(S1, { store, broadcastState: async () => {}, startDelayMs: DELAY }), 0);
});

// --- Consumo desde RabbitMQ ---

function envelope(data, overrides = {}) {
  return {
    specversion: '1.0',
    id: '8b9c0d1e-2f3a-4b5c-9d6e-7f8091a2b3c4',
    source: '/services/catalog',
    type: 'song.deleted.v1',
    time: '2026-11-13T13:00:00Z',
    subject: `song/${S1}`,
    datacontenttype: 'application/json',
    data,
    ...overrides,
  };
}
const validData = { song_id: S1, artist_id: ARTIST, deleted_by: ARTIST, title: 'Uno' };

function delivery(event, routingKey = 'song.deleted.v1') {
  return { content: Buffer.from(typeof event === 'string' ? event : JSON.stringify(event)), fields: { routingKey } };
}

function fakeChannel() {
  const calls = [];
  return {
    calls,
    ack: () => calls.push(['ack']),
    nack: (_m, _all, requeue) => calls.push(['nack', requeue]),
  };
}

test('parseSongDeleted valida el sobre, el tipo y el data contra los contratos', () => {
  assert.deepEqual(events.parseSongDeleted(delivery(envelope(validData)).content, 'song.deleted.v1'), validData);
  const invalid = [
    ['no es json', 'song.deleted.v1'],
    [JSON.stringify(envelope(validData)), 'room.created.v1'],
    [JSON.stringify(envelope(validData, { type: 'room.created.v1' })), 'song.deleted.v1'],
    [JSON.stringify(envelope({ ...validData, song_id: 'x' })), 'song.deleted.v1'],
    [JSON.stringify(envelope({ song_id: S1 })), 'song.deleted.v1'],
    [JSON.stringify(envelope(validData, { specversion: '0.3' })), 'song.deleted.v1'],
  ];
  for (const [body, key] of invalid) {
    assert.throws(() => events.parseSongDeleted(Buffer.from(body), key), events.InvalidEvent, body);
  }
});

test('handleDelivery: ack si salio bien, a la cola de errores si es invalido, reintento si falla', async () => {
  const quiet = console.warn;
  console.warn = () => {};
  try {
    const seen = [];
    let ch = fakeChannel();
    assert.equal(await events.handleDelivery(ch, delivery(envelope(validData)), async (d) => seen.push(d.song_id)), 'ack');
    assert.deepEqual(ch.calls, [['ack']]);
    assert.deepEqual(seen, [S1]);

    ch = fakeChannel();
    assert.equal(await events.handleDelivery(ch, delivery('{'), async () => seen.push('no')), 'dead');
    assert.deepEqual(ch.calls, [['nack', false]]);

    ch = fakeChannel();
    const failing = async () => { throw new Error('Redis caido'); };
    assert.equal(await events.handleDelivery(ch, delivery(envelope(validData)), failing, { retryAfterMs: 0 }), 'retry');
    assert.deepEqual(ch.calls, [['nack', true]]);
    assert.deepEqual(seen, [S1]);
  } finally {
    console.warn = quiet;
  }
});
