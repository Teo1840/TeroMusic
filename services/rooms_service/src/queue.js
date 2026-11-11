const { randomUUID } = require('node:crypto');

const playback = require('./playback');

const { CommandError } = playback;

/**
 * Cola de la sala ("a continuación") y sugerencias de los oyentes.
 *
 *   queue        → canciones que van a sonar, en orden. Al terminar una, arranca la primera.
 *   suggestions  → canciones que propuso un oyente. Un anfitrion/coanfitrion las acepta
 *                  (pasan al final de la cola) o las rechaza.
 *
 * Cada elemento: { item_id, song_id, title, duration_sec, added_by: { user_id, name } }
 * item_id identifica la entrada (la misma cancion puede estar dos veces en la cola).
 */

const MAX_QUEUE = 100;
const MAX_SUGGESTIONS = 50;
const MAX_PENDING_PER_USER = 3;
// Margen para dar por terminada una cancion (relojes y redondeos).
const END_TOLERANCE_MS = 1000;

function makeItem(song, user) {
  return {
    item_id: randomUUID(),
    song_id: song.id,
    title: song.title ?? null,
    duration_sec: typeof song.duration === 'number' ? song.duration : null,
    added_by: { user_id: user.id, name: user.name },
  };
}

function indexOf(list, itemId) {
  const index = list.findIndex((item) => item.item_id === itemId);
  if (index === -1) throw new CommandError('Ese elemento ya no esta en la lista');
  return index;
}

function append(queue, item) {
  if (queue.length >= MAX_QUEUE) throw new CommandError(`La cola admite hasta ${MAX_QUEUE} canciones`);
  return [...queue, item];
}

function remove(list, itemId) {
  const index = indexOf(list, itemId);
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

function move(queue, itemId, toIndex) {
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= queue.length) {
    throw new CommandError(`to_index debe ser un entero entre 0 y ${queue.length - 1}`);
  }
  const from = indexOf(queue, itemId);
  const result = [...queue];
  const [item] = result.splice(from, 1);
  result.splice(toIndex, 0, item);
  return result;
}

/** Sugerencia de un oyente: sin repetir canciones y con tope por usuario. */
function suggest(suggestions, queue, item) {
  if (queue.some((q) => q.song_id === item.song_id)) throw new CommandError('Esa cancion ya esta en la cola');
  if (suggestions.some((s) => s.song_id === item.song_id)) throw new CommandError('Esa cancion ya fue sugerida');
  const mine = suggestions.filter((s) => s.added_by.user_id === item.added_by.user_id).length;
  if (mine >= MAX_PENDING_PER_USER) {
    throw new CommandError(`Podes tener hasta ${MAX_PENDING_PER_USER} sugerencias pendientes`);
  }
  if (suggestions.length >= MAX_SUGGESTIONS) throw new CommandError('Hay demasiadas sugerencias pendientes');
  return [...suggestions, item];
}

/** La cancion actual ya termino segun el reloj del servidor. Sin duracion conocida: no se puede saber. */
function isOver(pb, now) {
  if (!pb.song_id || !(pb.duration_sec > 0)) return false;
  return playback.positionAt(pb, now) >= pb.duration_sec * 1000 - END_TOLERANCE_MS;
}

/** No suena nada: no hay cancion o la que habia termino. */
function isIdle(pb, now) {
  return !pb.song_id || isOver(pb, now);
}

/** Pasa a la primera de la cola. Devuelve { playback, queue } o null si la cola esta vacia. */
function advance(queue, now, startDelayMs) {
  if (!queue.length) return null;
  const [next, ...rest] = queue;
  const song = { id: next.song_id, title: next.title, duration: next.duration_sec };
  return { playback: playback.setSong(song, now, startDelayMs), queue: rest };
}

/** Termino la cancion y no hay nada en la cola: queda en pausa al final. */
function stopAtEnd(pb, now) {
  return { ...pb, playing: false, position_ms: Math.round(pb.duration_sec * 1000), updated_at_ms: now };
}

module.exports = {
  MAX_QUEUE, MAX_SUGGESTIONS, MAX_PENDING_PER_USER, END_TOLERANCE_MS,
  makeItem, append, remove, move, suggest, isOver, isIdle, advance, stopAtEnd,
};
