const test = require('node:test');
const assert = require('node:assert/strict');

const commands = require('../src/commands');
const pb = require('../src/playback');
const queue = require('../src/queue');

const HOST = { id: '11111111-1111-4111-8111-111111111111', name: 'ana' };
const COHOST = { id: '22222222-2222-4222-8222-222222222222', name: 'juan' };
const LISTENER = { id: '33333333-3333-4333-8333-333333333333', name: 'lu' };
const LISTENER2 = { id: '44444444-4444-4444-8444-444444444444', name: 'flor' };

const SONGS = {
  'a0000000-0000-4000-8000-000000000001': { title: 'Uno', status: 'PUBLICADO', duration: 100 },
  'a0000000-0000-4000-8000-000000000002': { title: 'Dos', status: 'PUBLICADO', duration: 200 },
  'a0000000-0000-4000-8000-000000000003': { title: 'Tres', status: 'PUBLICADO', duration: 300 },
  'a0000000-0000-4000-8000-000000000004': { title: 'Cuatro', status: 'PUBLICADO', duration: 400 },
  'a0000000-0000-4000-8000-000000000009': { title: 'Borrador', status: 'BORRADOR', duration: null },
};
const [S1, S2, S3, S4] = Object.keys(SONGS);
const DRAFT = 'a0000000-0000-4000-8000-000000000009';

const room = { id: 'r', host_id: HOST.id };
const DELAY = 1_500;

/** Ejecuta comandos en orden sobre un estado en memoria (como hace el hub con Redis). */
function roomState(initialPlayback = pb.initial()) {
  const state = { playback: initialPlayback, queue: [], suggestions: [], cohosts: [COHOST.id] };
  state.run = async (user, message, now = 10_000) => {
    const change = await commands.apply(message, {
      room, cohosts: state.cohosts, user, now, startDelayMs: DELAY,
      playback: state.playback, queue: state.queue, suggestions: state.suggestions,
      getSong: async (id) => SONGS[id] ?? null,
    });
    if (change.playback) state.playback = change.playback;
    if (change.queue) state.queue = change.queue;
    if (change.suggestions) state.suggestions = change.suggestions;
    return change;
  };
  return state;
}

const titles = (list) => list.map((item) => item.title);

test('agregar a la cola: si no suena nada, arranca enseguida', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  assert.equal(s.playback.song_id, S1);
  assert.equal(s.playback.playing, true);
  assert.equal(s.playback.updated_at_ms, 10_000 + DELAY);
  assert.deepEqual(s.queue, []);
});

test('agregar a la cola: si ya suena algo, queda esperando en orden', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(COHOST, { type: 'queue_add', song_id: S2 });
  await s.run(HOST, { type: 'queue_add', song_id: S3 });
  assert.equal(s.playback.song_id, S1);
  assert.deepEqual(titles(s.queue), ['Dos', 'Tres']);
  assert.deepEqual(s.queue[0].added_by, { user_id: COHOST.id, name: 'juan' });
});

test('al terminar la cancion pasa sola a la siguiente (y solo una vez)', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  const { song_id: songId, updated_at_ms: updatedAt } = s.playback;
  const end = updatedAt + 100_000;

  // Antes de tiempo: no pasa nada (alguien no puede saltear mandando "ended").
  assert.deepEqual(await s.run(LISTENER, { type: 'ended', song_id: songId, updated_at_ms: updatedAt }, end - 5_000), {});

  // Dos navegadores avisan a la vez: el primero avanza, el segundo ya es viejo.
  await s.run(LISTENER, { type: 'ended', song_id: songId, updated_at_ms: updatedAt }, end);
  assert.equal(s.playback.song_id, S2);
  assert.deepEqual(s.queue, []);
  assert.deepEqual(await s.run(LISTENER2, { type: 'ended', song_id: songId, updated_at_ms: updatedAt }, end + 10), {});
  assert.equal(s.playback.song_id, S2);
});

test('al terminar sin nada en la cola queda en pausa al final; agregar arranca de nuevo', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  const { song_id: songId, updated_at_ms: updatedAt } = s.playback;
  const end = updatedAt + 100_000;
  await s.run(LISTENER, { type: 'ended', song_id: songId, updated_at_ms: updatedAt }, end);
  assert.equal(s.playback.playing, false);
  assert.equal(s.playback.position_ms, 100_000);

  await s.run(HOST, { type: 'queue_add', song_id: S2 }, end + 5_000);
  assert.equal(s.playback.song_id, S2);
  assert.equal(s.playback.playing, true);
});

test('siguiente: salta a la primera de la cola; error si esta vacia', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  await s.run(COHOST, { type: 'next' });
  assert.equal(s.playback.song_id, S2);
  await assert.rejects(s.run(HOST, { type: 'next' }), /No hay canciones/);
});

test('poner ahora (set_song) no toca la cola', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  await s.run(HOST, { type: 'set_song', song_id: S3 });
  assert.equal(s.playback.song_id, S3);
  assert.deepEqual(titles(s.queue), ['Dos']);
});

test('reordenar y sacar de la cola', async () => {
  const s = roomState();
  for (const id of [S1, S2, S3, S4]) await s.run(HOST, { type: 'queue_add', song_id: id });
  assert.deepEqual(titles(s.queue), ['Dos', 'Tres', 'Cuatro']);

  await s.run(COHOST, { type: 'queue_move', item_id: s.queue[2].item_id, to_index: 0 });
  assert.deepEqual(titles(s.queue), ['Cuatro', 'Dos', 'Tres']);
  await s.run(HOST, { type: 'queue_remove', item_id: s.queue[1].item_id });
  assert.deepEqual(titles(s.queue), ['Cuatro', 'Tres']);

  await assert.rejects(s.run(HOST, { type: 'queue_move', item_id: s.queue[0].item_id, to_index: 5 }), /to_index/);
  await assert.rejects(
    s.run(HOST, { type: 'queue_remove', item_id: 'bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f' }),
    /ya no esta/,
  );
});

test('la misma cancion puede estar dos veces en la cola', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  assert.deepEqual(titles(s.queue), ['Dos', 'Dos']);
  assert.notEqual(s.queue[0].item_id, s.queue[1].item_id);
});

test('oyentes: no pueden tocar la cola, pero si sugerir', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  for (const message of [
    { type: 'queue_add', song_id: S2 }, { type: 'next' },
    { type: 'queue_remove', item_id: S1 }, { type: 'queue_move', item_id: S1, to_index: 0 },
    { type: 'suggestion_accept', item_id: S1 }, { type: 'suggestion_reject', item_id: S1 },
  ]) {
    await assert.rejects(s.run(LISTENER, message), /anfitrion/, message.type);
  }

  await s.run(LISTENER, { type: 'suggest', song_id: S2 });
  assert.deepEqual(titles(s.suggestions), ['Dos']);
  assert.deepEqual(s.queue, []);
});

test('sugerencias: aceptar pasa a la cola, rechazar la descarta', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(LISTENER, { type: 'suggest', song_id: S2 });
  await s.run(LISTENER2, { type: 'suggest', song_id: S3 });

  await s.run(COHOST, { type: 'suggestion_accept', item_id: s.suggestions[0].item_id });
  assert.deepEqual(titles(s.queue), ['Dos']);
  assert.deepEqual(s.queue[0].added_by.name, 'lu'); // conserva quien la sugirio
  assert.deepEqual(titles(s.suggestions), ['Tres']);

  await s.run(HOST, { type: 'suggestion_reject', item_id: s.suggestions[0].item_id });
  assert.deepEqual(s.suggestions, []);
});

test('sugerencias: sin repetidas, tope por oyente y el que controla agrega directo', async () => {
  const s = roomState();
  await s.run(HOST, { type: 'queue_add', song_id: S1 });
  await s.run(HOST, { type: 'queue_add', song_id: S2 });
  await assert.rejects(s.run(LISTENER, { type: 'suggest', song_id: S2 }), /ya esta en la cola/);

  await s.run(LISTENER, { type: 'suggest', song_id: S3 });
  await assert.rejects(s.run(LISTENER2, { type: 'suggest', song_id: S3 }), /ya fue sugerida/);
  await s.run(LISTENER, { type: 'suggest', song_id: S4 });
  await s.run(LISTENER, { type: 'suggest', song_id: S1 });
  await assert.rejects(s.run(LISTENER, { type: 'suggest', song_id: S1 }), /ya fue sugerida/);

  // Tope de pendientes por usuario
  const extra = roomState();
  for (const id of [S1, S2, S3]) await extra.run(LISTENER, { type: 'suggest', song_id: id });
  await assert.rejects(extra.run(LISTENER, { type: 'suggest', song_id: S4 }), /hasta 3/);

  // Coanfitrion que "sugiere" va directo a la cola
  await s.run(COHOST, { type: 'suggest', song_id: S3 });
  assert.deepEqual(titles(s.queue), ['Dos', 'Tres']);
});

test('no se pueden agregar canciones que no estan publicadas', async () => {
  const s = roomState();
  await assert.rejects(s.run(HOST, { type: 'queue_add', song_id: DRAFT }), /publicada/);
  await assert.rejects(s.run(LISTENER, { type: 'suggest', song_id: DRAFT }), /publicada/);
});

test('isOver: usa el reloj del servidor con un margen', () => {
  const playing = pb.setSong({ id: S1, duration: 100 }, 0, 0);
  assert.equal(queue.isOver(playing, 98_000), false);
  assert.equal(queue.isOver(playing, 99_000), true);
  assert.equal(queue.isOver({ ...playing, duration_sec: null }, 999_999), false);
  assert.equal(queue.isIdle(pb.initial(), 0), true);
});
