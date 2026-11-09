const test = require('node:test');
const assert = require('node:assert/strict');

const { sign, verify, Unauthorized } = require('../src/auth');

const SECRET = 'secreto-de-prueba';

test('acepta un token HS256 valido', () => {
  const token = sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal(verify(token, SECRET).sub, 'u1');
});

test('rechaza firma, vencimiento, alg none y formato', () => {
  const token = sign({ sub: 'u1' }, SECRET);
  assert.throws(() => verify(token, 'otro-secreto'), Unauthorized);
  assert.throws(() => verify(sign({ sub: 'u1', exp: 1 }, SECRET), SECRET), Unauthorized);
  assert.throws(() => verify('a.b', SECRET), Unauthorized);
  assert.throws(() => verify(token, ''), Unauthorized);

  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${token.split('.')[1]}.`;
  assert.throws(() => verify(none, SECRET), Unauthorized);
});
