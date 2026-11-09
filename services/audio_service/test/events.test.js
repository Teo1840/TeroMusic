const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { buildSongPlayed, InvalidEvent } = require('../src/events');

const CONTRACTS = [path.resolve(__dirname, '../../../contracts'), path.resolve(__dirname, '../contracts')]
  .find((dir) => fs.existsSync(dir));

const data = {
  song_id: 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
  user_id: '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60',
  started_at: '2026-11-09T15:04:05Z',
  listened_sec: 187.4,
  completed: true,
  bitrate_kbps: 128,
  client: 'web',
};

test('song.played.v1 cumple el sobre de contracts/', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const envelope = ajv.compile(JSON.parse(fs.readFileSync(path.join(CONTRACTS, 'envelope.schema.json'), 'utf8')));

  const event = buildSongPlayed(data, { correlationId: 'req-test' });
  assert.ok(envelope(event), JSON.stringify(envelope.errors));
  assert.equal(event.type, 'song.played.v1');
  assert.equal(event.source, '/services/audio');
  assert.equal(event.subject, `song/${data.song_id}`);
  assert.equal(event.correlationid, 'req-test');
  assert.deepEqual(event.data, data);
});

test('cada evento tiene un id nuevo', () => {
  assert.notEqual(buildSongPlayed(data).id, buildSongPlayed(data).id);
});

test('rechaza data que no cumple el schema', () => {
  const invalid = [
    { ...data, started_at: undefined },
    { ...data, listened_sec: undefined },
    { ...data, listened_sec: -1 },
    { ...data, started_at: '2026-11-09T15:04:05-03:00' }, // tiene que terminar en Z
    { ...data, song_id: 'no-es-uuid' },
    { ...data, extra: 1 },
  ].map((d) => JSON.parse(JSON.stringify(d)));
  for (const d of invalid) assert.throws(() => buildSongPlayed(d), InvalidEvent, JSON.stringify(d));
});
