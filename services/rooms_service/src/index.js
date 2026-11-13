const { createApp } = require('./app');
const catalog = require('./catalog');
const config = require('./config');
const { removeDeletedSong } = require('./deleted');
const events = require('./events');
const { Hub } = require('./hub');
const store = require('./store');

async function main() {
  if (!config.jwtSecret) console.warn('[rooms] JWT_SECRET vacio: nadie va a poder autenticarse');
  await store.connect();

  const app = createApp({ store, events });
  const hub = new Hub({ store, getSong: catalog.getSong });
  await hub.start();

  // Cancion borrada del catalogo: sacarla de las salas abiertas.
  events.onSongDeleted(async ({ song_id: songId }) => {
    const rooms = await removeDeletedSong(songId, {
      store,
      broadcastState: (roomId) => hub.broadcastState(roomId),
      startDelayMs: config.startDelayMs,
    });
    if (rooms) console.log(`[rooms] Cancion ${songId} borrada: se saco de ${rooms} sala(s)`);
  });
  events.connect(); // reintenta solo; las salas funcionan aunque RabbitMQ tarde

  const server = app.listen(config.port, () => {
    console.log(`[rooms] Escuchando en :${config.port} (copia ${store.instanceId.slice(0, 8)})`);
  });
  hub.attach(server);

  const shutdown = () => {
    console.log('[rooms] Cerrando');
    hub.close();
    server.close(async () => {
      await events.close();
      await store.close();
      process.exit(0);
    });
    // Los WebSockets pueden tardar en cerrar: no esperar para siempre.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
