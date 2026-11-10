const { createHmac, timingSafeEqual } = require('node:crypto');

const config = require('./config');

class Unauthorized extends Error {}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** Verifica un JWT HS256 y devuelve su payload. Lanza Unauthorized si no es valido. */
function verify(token, secret = config.jwtSecret, now = Date.now()) {
  if (!secret) throw new Unauthorized('JWT_SECRET no configurado');
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw new Unauthorized('Token mal formado');

  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new Unauthorized('Token mal formado');
  }
  // Solo HS256: evita aceptar "alg: none" u otros algoritmos.
  if (header.alg !== 'HS256') throw new Unauthorized('Algoritmo no soportado');

  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Unauthorized('Firma invalida');
  }

  const seconds = Math.floor(now / 1000);
  if (typeof payload.exp === 'number' && seconds >= payload.exp) throw new Unauthorized('Token vencido');
  if (typeof payload.nbf === 'number' && seconds < payload.nbf) throw new Unauthorized('Token todavia no valido');
  return payload;
}

/** user_id del header "Authorization: Bearer <jwt>". */
function userIdFrom(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization') || '');
  if (!match) throw new Unauthorized('Falta el header Authorization: Bearer <token>');
  const userId = verify(match[1])[config.jwtUserClaim];
  if (typeof userId !== 'string' || !userId) throw new Unauthorized(`El token no trae "${config.jwtUserClaim}"`);
  return userId;
}

/** Firma un token (para tests y pruebas manuales). */
function sign(payload, secret = config.jwtSecret) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

module.exports = { Unauthorized, verify, userIdFrom, sign };
