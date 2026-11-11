const { createHmac, timingSafeEqual } = require('node:crypto');

const config = require('./config');

/**
 * URLs temporales firmadas para el stream (como las presigned URLs de S3).
 * <audio src> no puede mandar Authorization, asi que el permiso viaja en la URL:
 *   /audio/stream/{song_id}?exp=<unix seg>&sig=<HMAC-SHA256 base64url>
 * La firma cubre song_id + exp: no sirve para otra cancion ni despues de vencer.
 */

class InvalidSignature extends Error {}

function signature(songId, exp, secret) {
  // Prefijo "stream-url" para que la firma no se pueda confundir con un JWT.
  return createHmac('sha256', secret).update(`stream-url:${songId}:${exp}`).digest('base64url');
}

/** Devuelve { url, expiresAt } para la cancion. */
function signedUrl(songId, { secret = config.streamUrlSecret, ttlSec = config.streamUrlTtlSec, now = Date.now() } = {}) {
  if (!secret) throw new Error('JWT_SECRET no configurado');
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = signature(songId, exp, secret);
  return {
    url: `${config.publicStreamPath}/${songId}?exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Lanza InvalidSignature si falta, no coincide o vencio. */
function verify(songId, query, { secret = config.streamUrlSecret, now = Date.now() } = {}) {
  const { exp, sig } = query;
  if (typeof exp !== 'string' || typeof sig !== 'string') throw new InvalidSignature('Falta la firma (exp y sig)');
  if (!secret) throw new InvalidSignature('JWT_SECRET no configurado');

  const expected = Buffer.from(signature(songId, exp, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new InvalidSignature('Firma invalida');
  }
  if (!/^\d+$/.test(exp) || Math.floor(now / 1000) >= Number(exp)) throw new InvalidSignature('URL vencida');
}

module.exports = { InvalidSignature, signedUrl, verify };
