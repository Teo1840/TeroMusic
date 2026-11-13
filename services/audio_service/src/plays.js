const cache = require('./cache');
const config = require('./config');

/**
 * Reglas para que una reproduccion cuente (POST /audio/played). El cliente es el que
 * dice cuanto escucho, asi que el servidor desconfia:
 *
 *   1. Tiempos coherentes: started_at no esta en el futuro ni es de hace mas de un dia, y
 *      started_at + listened_sec no pasa de "ahora" (no se puede haber escuchado mas
 *      tiempo del que paso).
 *   2. listened_sec no supera la duracion de la cancion (con un margen).
 *   3. Minimo escuchado: PLAY_MIN_SEC (30 s, como las plataformas grandes) o la cancion
 *      entera si dura menos. Lo que no llega se acepta pero no se cuenta.
 *   4. Una persona no escucha dos cosas a la vez: cada reproduccion contada ocupa el tramo
 *      [started_at, started_at + listened_sec] del usuario, y una nueva que empiece antes
 *      de que termine la anterior no cuenta. Asi, repetir el pedido (o mandarlo en bucle)
 *      no infla el contador: en una hora entran como mucho 3600 / PLAY_MIN_SEC.
 *      El ultimo fin de cada usuario vive en Redis (compartido entre copias del servicio)
 *      y se actualiza con un script Lua (atomico: dos pedidos a la vez no pasan los dos).
 */

const CLOCK_SKEW_MS = 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DURATION_SLACK_SEC = 5;
// Margen entre una reproduccion y la siguiente (redondeos y relojes).
const OVERLAP_TOLERANCE_MS = 2000;
const TIMELINE_TTL_SEC = 2 * 24 * 60 * 60;

class InvalidPlay extends Error {}

const timelineKey = (userId) => `plays:last_end:${userId}`;

/** Regla 1: se puede chequear antes de consultar el catalogo. */
function checkTimes(body, now) {
  const started = Date.parse(body.started_at);
  if (started > now + CLOCK_SKEW_MS) throw new InvalidPlay('started_at esta en el futuro');
  if (started < now - MAX_AGE_MS) throw new InvalidPlay('started_at es de hace mas de 24 horas');
  if (started + body.listened_sec * 1000 > now + CLOCK_SKEW_MS) {
    throw new InvalidPlay('listened_sec es mayor que el tiempo que paso desde started_at');
  }
}

/** Regla 2. */
function checkDuration(body, song) {
  const duration = Number(song.duration);
  if (duration > 0 && body.listened_sec > duration + DURATION_SLACK_SEC) {
    throw new InvalidPlay(`listened_sec (${body.listened_sec}) supera la duracion de la cancion (${duration})`);
  }
}

/** Regla 3: segundos minimos para contar. */
function minListenedSec(song) {
  const duration = Number(song.duration);
  if (duration > 0) return Math.min(config.playMinSec, Math.max(1, duration - 1));
  return config.playMinSec;
}

const CLAIM = `
local last = tonumber(redis.call('get', KEYS[1]) or '0')
if tonumber(ARGV[1]) < last then return 0 end
redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1`;

/**
 * Regla 4: reserva el tramo del usuario. true si no se superpone con la ultima contada.
 * Sin Redis no se puede saber: se cuenta igual (la musica no depende de la cache).
 */
async function claim(userId, startedMs, endMs) {
  try {
    const ok = await cache.redis.eval(
      CLAIM, 1, timelineKey(userId), String(startedMs + OVERLAP_TOLERANCE_MS), String(endMs), String(TIMELINE_TTL_SEC),
    );
    return ok === 1;
  } catch (error) {
    console.warn(`[plays] Redis no disponible, no se controla la superposicion: ${error.message}`);
    return true;
  }
}

/**
 * Decide si la reproduccion cuenta. Lanza InvalidPlay si los datos son imposibles.
 * Devuelve { counted: true } o { counted: false, reason }.
 */
async function evaluate(userId, body, song) {
  checkDuration(body, song);
  if (body.listened_sec < minListenedSec(song)) return { counted: false, reason: 'too_short' };
  const started = Date.parse(body.started_at);
  const ok = await module.exports.claim(userId, started, started + Math.round(body.listened_sec * 1000));
  return ok ? { counted: true } : { counted: false, reason: 'overlap' };
}

module.exports = { InvalidPlay, checkTimes, checkDuration, minListenedSec, claim, evaluate, timelineKey };
