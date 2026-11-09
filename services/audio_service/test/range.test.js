const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRange, chunksFor, RangeNotSatisfiable, MAX_RESPONSE_BYTES } = require('../src/range');

const MiB = 1024 * 1024;
const SIZE = Math.floor(2.5 * MiB); // 3 fragmentos: 0, 1 y 2 (medio)

test('ejemplo de la consigna: bytes=0-1048575', () => {
  assert.deepEqual(parseRange('bytes=0-1048575', SIZE, MiB), { start: 0, end: 1048575 });
});

test('sin header se trata como bytes=0- y devuelve el primer fragmento', () => {
  assert.deepEqual(parseRange(undefined, SIZE, MiB), { start: 0, end: MiB - 1 });
});

test('rango abierto termina al final de su fragmento', () => {
  assert.deepEqual(parseRange('bytes=0-', SIZE, MiB), { start: 0, end: MiB - 1 });
  assert.deepEqual(parseRange('bytes=1500000-', SIZE, MiB), { start: 1500000, end: 2 * MiB - 1 });
  // Ultimo fragmento: no pasa del final del archivo.
  assert.deepEqual(parseRange(`bytes=${2 * MiB}-`, SIZE, MiB), { start: 2 * MiB, end: SIZE - 1 });
});

test('rango explicito se respeta y se recorta al tamano del archivo', () => {
  assert.deepEqual(parseRange('bytes=100-199', SIZE, MiB), { start: 100, end: 199 });
  assert.deepEqual(parseRange('bytes=100-99999999', SIZE, MiB), { start: 100, end: SIZE - 1 });
});

test('rango explicito enorme se limita a MAX_RESPONSE_BYTES', () => {
  const big = 100 * MiB;
  assert.deepEqual(parseRange(`bytes=0-${big}`, big + 1, MiB), { start: 0, end: MAX_RESPONSE_BYTES - 1 });
});

test('sufijo bytes=-n devuelve los ultimos n bytes', () => {
  assert.deepEqual(parseRange('bytes=-10', SIZE, MiB), { start: SIZE - 10, end: SIZE - 1 });
  assert.deepEqual(parseRange(`bytes=-${SIZE * 2}`, SIZE, MiB), { start: 0, end: SIZE - 1 });
});

test('rango mal formado o multiple se ignora (primer fragmento)', () => {
  assert.deepEqual(parseRange('bytes=0-1,5-6', SIZE, MiB), { start: 0, end: MiB - 1 });
  assert.deepEqual(parseRange('basura', SIZE, MiB), { start: 0, end: MiB - 1 });
});

test('fuera del archivo lanza RangeNotSatisfiable (416)', () => {
  for (const header of [`bytes=${SIZE}-`, 'bytes=-0', 'bytes=50-10']) {
    assert.throws(() => parseRange(header, SIZE, MiB), RangeNotSatisfiable, header);
  }
});

test('chunksFor calcula los fragmentos que cubren el rango', () => {
  assert.deepEqual(chunksFor(0, MiB - 1, MiB), [0]);
  assert.deepEqual(chunksFor(MiB, MiB + 99, MiB), [1]);
  assert.deepEqual(chunksFor(MiB - 10, MiB + 10, MiB), [0, 1]);
  assert.deepEqual(chunksFor(0, SIZE - 1, MiB), [0, 1, 2]);
});
