/**
 * Foto completa de una sala, igual para REST (GET /rooms/{id}) y WebSocket (type "state").
 * server_time permite a cada cliente calcular la posicion exacta (ver playback.js).
 */
async function snapshot(store, roomId, now = Date.now()) {
  const room = await store.getRoom(roomId);
  if (!room) return null;
  const [cohosts, playback, queue, suggestions, listeners] = await Promise.all([
    store.getCohosts(roomId),
    store.getPlayback(roomId),
    store.getQueue(roomId),
    store.getSuggestions(roomId),
    store.listeners(roomId),
  ]);
  return { room: { ...room, cohosts }, playback, queue, suggestions, listeners, server_time: now };
}

module.exports = { snapshot };
