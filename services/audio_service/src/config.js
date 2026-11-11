const env = process.env;

function int(name, fallback) {
  const value = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = {
  port: int('PORT', 8000),

  minio: {
    endPoint: env.MINIO_ENDPOINT || 'minio',
    port: int('MINIO_PORT', 9000),
    useSSL: (env.MINIO_SECURE || 'false').toLowerCase() === 'true',
    accessKey: env.MINIO_USER || 'minioadmin',
    secretKey: env.MINIO_PASS || 'minioadminpassword',
  },
  // Bucket y rutas que escribe worker_ingesta.
  bucket: env.AUDIO_BUCKET || 'audio',
  // Solo se usa si el catalogo no trae renditions. {song_id} y {bitrate} se reemplazan.
  keyTemplate: env.AUDIO_KEY_TEMPLATE || 'processed/{song_id}/{bitrate}.mp3',
  bitrates: [128, 320],
  defaultBitrate: 128,

  // catalog_service: GET /songs/{song_id} dice si la cancion esta PUBLICADO.
  catalogUrl: (env.CATALOG_URL || 'http://catalog_service:8000').replace(/\/+$/, ''),
  catalogTimeoutMs: int('CATALOG_TIMEOUT_MS', 3000),
  catalogCacheTtlSec: int('CATALOG_CACHE_TTL_SEC', 60),

  // JWT HS256 firmado con JWT_SECRET; el usuario sale del claim JWT_USER_CLAIM.
  jwtSecret: env.JWT_SECRET || '',
  jwtUserClaim: env.JWT_USER_CLAIM || 'sub',

  // URLs firmadas del stream: mismo secreto que el JWT, vencen a los STREAM_URL_TTL_SEC.
  streamUrlSecret: env.STREAM_URL_SECRET || env.JWT_SECRET || '',
  streamUrlTtlSec: int('STREAM_URL_TTL_SEC', 3600),
  // Ruta publica (via gateway) que se devuelve en la URL firmada.
  publicStreamPath: (env.PUBLIC_STREAM_PATH || '/api/v1/audio/stream').replace(/\/+$/, ''),

  redisUrl: env.REDIS_URL || 'redis://redis:6379',
  cacheTtlSec: int('CACHE_TTL_SEC', 3600),
  // 1 MiB: el tamano del ejemplo de la consigna (bytes=0-1048575).
  chunkSize: int('CHUNK_SIZE', 1024 * 1024),

  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672',
};
