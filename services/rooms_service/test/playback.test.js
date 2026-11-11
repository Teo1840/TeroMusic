const test = require('node:test');
const assert = require('node:assert/strict');

const pb = require('../src/playback');

const song = { id: 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f', title: 'Tema', duration: 180 };

test('posicion: avanza con el reloj solo si esta sonando', () => {
  const playing = { ...pb.initial(), song_id: song.id, playing: true, position_ms: 10_000, updated_at_ms: 1_000 };
  assert.equal(pb.positionAt(playing, 1_000), 10_000);
  assert.equal(pb.positionAt(playing, 4_500), 13_500);
  assert.equal(pb.positionAt({ ...playing, playing: false }, 99_000), 10_000);
});

test('posicion: no pasa del final de la cancion', () => {
  const playing = { ...pb.setSong(song, 0, 0) };
  assert.equal(pb.positionAt(playing, 999_999), 180_000);
});

test('set_song: arranca en 0 despues del margen de carga', () => {
  const state = pb.setSong(song, 10_000, 1_500);
  assert.equal(state.song_id, song.id);
  assert.equal(state.title, 'Tema');
  assert.equal(state.duration_sec, 180);
  assert.equal(state.playing, true);
  assert.equal(pb.positionAt(state, 10_000), 0); // todavia en el margen
  assert.equal(pb.positionAt(state, 11_500), 0);
  assert.equal(pb.positionAt(state, 12_500), 1_000);
});

test('pause congela la posicion y play sigue desde ahi', () => {
  let state = pb.setSong(song, 0, 0);
  state = pb.pause(state, 30_000);
  assert.equal(state.playing, false);
  assert.equal(pb.positionAt(state, 90_000), 30_000);
  state = pb.play(state, 90_000);
  assert.equal(pb.positionAt(state, 95_000), 35_000);
});

test('play al final vuelve a empezar', () => {
  const state = pb.play(pb.setSong(song, 0, 0), 500_000);
  assert.equal(pb.positionAt(state, 500_000), 0);
  assert.equal(pb.positionAt(state, 502_000), 2_000);
});

test('seek mueve la posicion y respeta play/pausa', () => {
  let state = pb.setSong(song, 0, 0);
  state = pb.seek(state, 60_000, 5_000);
  assert.equal(pb.positionAt(state, 6_000), 61_000);
  state = pb.seek(pb.pause(state, 6_000), 999_999, 7_000);
  assert.equal(pb.positionAt(state, 50_000), 180_000);
});

test('sin cancion: play, pause y seek fallan; seek invalido falla', () => {
  assert.throws(() => pb.play(pb.initial(), 0), pb.CommandError);
  assert.throws(() => pb.pause(pb.initial(), 0), pb.CommandError);
  assert.throws(() => pb.seek(pb.initial(), 0, 0), pb.CommandError);
  const state = pb.setSong(song, 0, 0);
  for (const bad of [-1, 'diez', NaN, Infinity, undefined]) {
    assert.throws(() => pb.seek(state, bad, 0), pb.CommandError, String(bad));
  }
});
