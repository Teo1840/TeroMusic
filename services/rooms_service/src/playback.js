/**
 * Estado de reproduccion de una sala. No se guarda "por donde va" segundo a segundo:
 * se guarda la posicion en un instante (updated_at_ms) y si esta sonando.
 * Cualquiera puede calcular la posicion actual:
 *
 *   posicion = position_ms + (ahora - updated_at_ms)   si esta sonando
 *   posicion = position_ms                              si esta en pausa
 *
 * Asi el servidor no tiene que mandar nada mientras la cancion avanza: solo cuando
 * alguien da play, pausa, adelanta o cambia de cancion.
 */

class CommandError extends Error {}

function initial() {
  return { song_id: null, title: null, duration_sec: null, playing: false, position_ms: 0, updated_at_ms: 0 };
}

/** Posicion en milisegundos en el instante `now` (nunca pasa del final de la cancion). */
function positionAt(playback, now) {
  let position = playback.position_ms;
  if (playback.playing) position += Math.max(0, now - playback.updated_at_ms);
  if (typeof playback.duration_sec === 'number' && playback.duration_sec > 0) {
    position = Math.min(position, playback.duration_sec * 1000);
  }
  return Math.round(position);
}

function requireSong(playback) {
  if (!playback.song_id) throw new CommandError('Primero hay que elegir una cancion');
}

function play(playback, now) {
  requireSong(playback);
  // Si termino, play vuelve a empezar.
  const ended = playback.duration_sec && positionAt(playback, now) >= playback.duration_sec * 1000;
  if (playback.playing && !ended) return playback;
  return { ...playback, playing: true, position_ms: ended ? 0 : positionAt(playback, now), updated_at_ms: now };
}

function pause(playback, now) {
  requireSong(playback);
  if (!playback.playing) return playback;
  return { ...playback, playing: false, position_ms: positionAt(playback, now), updated_at_ms: now };
}

function seek(playback, positionMs, now) {
  requireSong(playback);
  if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
    throw new CommandError('position_ms debe ser un numero >= 0');
  }
  let position = Math.round(positionMs);
  if (playback.duration_sec) position = Math.min(position, playback.duration_sec * 1000);
  return { ...playback, position_ms: position, updated_at_ms: now };
}

/** Cambia de cancion y arranca despues de `startDelayMs` para que todos la carguen. */
function setSong(song, now, startDelayMs) {
  return {
    song_id: song.id,
    title: song.title ?? null,
    duration_sec: typeof song.duration === 'number' ? song.duration : null,
    playing: true,
    position_ms: 0,
    updated_at_ms: now + startDelayMs,
  };
}

module.exports = { CommandError, initial, positionAt, play, pause, seek, setSong };
