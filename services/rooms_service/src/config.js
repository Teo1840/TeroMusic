const env = process.env;

function int(name, fallback) {
  const value = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  port: int('PORT', 8000),

  // JWT HS256 firmado por user_service con JWT_SECRET.
  jwtSecret: env.JWT_SECRET || '',
  jwtUserClaim: env.JWT_USER_CLAIM || 'sub',

  redisUrl: env.REDIS_URL || 'redis://redis:6379',
  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672',

  // catalog_service: para validar la cancion que se pone en la sala.
  catalogUrl: (env.CATALOG_URL || 'http://catalog_service:8000').replace(/\/+$/, ''),
  catalogTimeoutMs: int('CATALOG_TIMEOUT_MS', 3000),

  // Una sala sin actividad se borra sola despues de este tiempo.
  roomTtlSec: int('ROOM_TTL_SEC', 24 * 3600),
  defaultMaxListeners: int('ROOM_DEFAULT_MAX_LISTENERS', 50),

  // El cliente tiene que mandar {type:"auth"} antes de este tiempo.
  wsAuthTimeoutMs: int('WS_AUTH_TIMEOUT_MS', 5000),
  // Ping a cada conexion para detectar las que se cortaron sin avisar.
  wsHeartbeatMs: int('WS_HEARTBEAT_MS', 25000),
  // Margen al cambiar de cancion para que todos la carguen antes de arrancar.
  startDelayMs: int('ROOM_START_DELAY_MS', 1500),
};
