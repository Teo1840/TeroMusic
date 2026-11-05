const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { buildSongPlayed } = require('../src/events');
const { startsPlayback } = require('../src/app');

// En el repo: ../../../contracts. En la imagen Docker: /app/contracts.
const CONTRACTS = [path.resolve(__dirname, '../../../contracts'), path.resolve(__dirname, '../contracts')]
  .find((dir) => fs.existsSync(dir));

function validator(file) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(CONTRACTS, file), 'utf8')));
}

test('song.played.v1 cumple el sobre y el schema de contracts/', () => {
  const event = buildSongPlayed({
    songId: 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    userId: '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60',
    correlationId: 'req-test',
  });

  const envelope = validator('envelope.schema.json');
  assert.ok(envelope(event), JSON.stringify(envelope.errors));
  const data = validator('events/song.played.v1.schema.json');
  assert.ok(data(event.data), JSON.stringify(data.errors));

  assert.equal(event.type, 'song.played.v1');
  assert.equal(event.source, '/services/audio');
  assert.equal(event.data.listened_sec, 0);
  assert.match(event.time, /Z$/);
});

test('cada evento tiene un id nuevo', () => {
  const params = { songId: 'c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f', userId: '5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60' };
  assert.notEqual(buildSongPlayed(params).id, buildSongPlayed(params).id);
});

test('solo cuenta la peticion que empieza la reproduccion', () => {
  assert.equal(startsPlayback({ start: 0, end: 1048575 }), true);
  assert.equal(startsPlayback({ start: 0, end: 1 }), false); // sonda de Safari
  assert.equal(startsPlayback({ start: 1048576, end: 2097151 }), false); // adelantar
});
