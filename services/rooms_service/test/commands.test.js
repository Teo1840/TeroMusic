const test = require('node:test');
const assert = require('node:assert/strict');

const commands = require('../src/commands');
const pb = require('../src/playback');

const HOST = '11111111-1111-4111-8111-111111111111';
const COHOST = '22222222-2222-4222-8222-222222222222';
const LISTENER = '33333333-3333-4333-8333-333333333333';
const SONG = 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const DRAFT = 'aaaaaaaa-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

const room = { id: 'r', host_id: HOST };
const songs = {
  [SONG]: { title: 'Tema', status: 'PUBLICADO', duration: 120 },
  [DRAFT]: { title: 'Borrador', status: 'BORRADOR', duration: null },
};

function ctx(userId, playback = pb.setSong({ id: SONG, duration: 120 }, 0, 0)) {
  return {
    room, cohosts: [COHOST], playback, userId, now: 10_000, startDelayMs: 1_500,
    getSong: async (id) => songs[id] ?? null,
  };
}

test('roles: host, cohost y listener', () => {
  assert.equal(commands.roleOf(room, [COHOST], HOST), 'host');
  assert.equal(commands.roleOf(room, [COHOST], COHOST), 'cohost');
  assert.equal(commands.roleOf(room, [COHOST], LISTENER), 'listener');
});

test('anfitrion y coanfitrion controlan la musica', async () => {
  for (const user of [HOST, COHOST]) {
    const { playback } = await commands.apply({ type: 'pause' }, ctx(user));
    assert.equal(playback.playing, false, user);
    assert.equal(playback.position_ms, 10_000);
  }
  const { playback } = await commands.apply({ type: 'seek', position_ms: 30_000 }, ctx(COHOST));
  assert.equal(playback.position_ms, 30_000);
});

test('un oyente no puede controlar la musica', async () => {
  for (const message of [{ type: 'play' }, { type: 'pause' }, { type: 'seek', position_ms: 1 }, { type: 'set_song', song_id: SONG }]) {
    await assert.rejects(commands.apply(message, ctx(LISTENER)), /anfitrion/, message.type);
  }
});

test('set_song: valida que exista y este publicada', async () => {
  const { playback } = await commands.apply({ type: 'set_song', song_id: SONG }, ctx(COHOST));
  assert.equal(playback.song_id, SONG);
  assert.equal(playback.title, 'Tema');
  assert.equal(playback.updated_at_ms, 11_500);

  await assert.rejects(commands.apply({ type: 'set_song', song_id: DRAFT }, ctx(HOST)), /publicada/);
  await assert.rejects(
    commands.apply({ type: 'set_song', song_id: 'bbbbbbbb-1a2b-4c3d-8e9f-0a1b2c3d4e5f' }, ctx(HOST)),
    /no encontrada/,
  );
  await assert.rejects(commands.apply({ type: 'set_song', song_id: 'x' }, ctx(HOST)), /UUID/);
});

test('solo el anfitrion nombra y quita coanfitriones', async () => {
  assert.deepEqual(await commands.apply({ type: 'promote', user_id: LISTENER }, ctx(HOST)), { promote: LISTENER });
  assert.deepEqual(await commands.apply({ type: 'demote', user_id: COHOST }, ctx(HOST)), { demote: COHOST });

  await assert.rejects(commands.apply({ type: 'promote', user_id: LISTENER }, ctx(COHOST)), /Solo el anfitrion/);
  await assert.rejects(commands.apply({ type: 'promote', user_id: LISTENER }, ctx(LISTENER)), /Solo el anfitrion/);
  await assert.rejects(commands.apply({ type: 'promote', user_id: HOST }, ctx(HOST)), /no puede ser coanfitrion/);
  await assert.rejects(commands.apply({ type: 'promote', user_id: 'x' }, ctx(HOST)), /UUID/);
});

test('comando desconocido', async () => {
  await assert.rejects(commands.apply({ type: 'borrar_todo' }, ctx(HOST)), /desconocido/);
  await assert.rejects(commands.apply(null, ctx(HOST)), commands.CommandError);
});
