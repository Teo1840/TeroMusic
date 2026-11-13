const queue = require('./queue');

/**
 * song.deleted.v1: el artista borro una cancion del catalogo. Se saca de la cola y las
 * sugerencias de todas las salas abiertas; si estaba sonando, pasa a la siguiente.
 * Cada sala se modifica con su candado (como un comando mas) y se avisa a los conectados.
 *
 * Devuelve cuantas salas cambiaron. Es idempotente: repetir el evento no cambia nada.
 */
async function removeDeletedSong(songId, { store, broadcastState, now = Date.now, startDelayMs }) {
  let changed = 0;
  for (const roomId of await store.roomIds()) {
    // eslint-disable-next-line no-await-in-loop
    const didChange = await store.withLock(roomId, async () => {
      if (!(await store.getRoom(roomId))) return false;
      const [playback, list, suggestions] = await Promise.all([
        store.getPlayback(roomId),
        store.getQueue(roomId),
        store.getSuggestions(roomId),
      ]);
      const change = queue.dropSong({ playback, queue: list, suggestions }, songId, now(), startDelayMs);
      if (Object.keys(change).length === 0) return false;
      await store.saveChanges(roomId, change);
      return true;
    });
    if (didChange) {
      changed += 1;
      // eslint-disable-next-line no-await-in-loop
      await broadcastState(roomId);
    }
  }
  return changed;
}

module.exports = { removeDeletedSong };
