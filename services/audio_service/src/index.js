const { app } = require('./app');
const cache = require('./cache');
const config = require('./config');
const events = require('./events');

async function main() {
  if (!config.jwtSecret) console.warn('[audio] JWT_SECRET vacio: POST /audio/played respondera 401');
  await cache.connect();
  await events.connect();
  const server = app.listen(config.port, () => {
    console.log(`[audio] Escuchando en :${config.port} (bucket ${config.bucket}, catalogo ${config.catalogUrl})`);
  });

  const shutdown = () => {
    console.log('[audio] Cerrando');
    server.close(async () => {
      await events.close();
      await cache.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
