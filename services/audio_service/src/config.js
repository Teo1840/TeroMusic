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
  bucket: env.PROCESSED_BUCKET || 'processed-audio',
  // Ruta del archivo dentro del bucket. {song_id} se reemplaza por el id.
  keyTemplate: env.AUDIO_KEY_TEMPLATE || '{song_id}/128.mp3',

  redisUrl: env.REDIS_URL || 'redis://redis:6379',
  cacheTtlSec: int('CACHE_TTL_SEC', 3600),
  // 1 MiB: el tamano del ejemplo de la consigna (bytes=0-1048575).
  chunkSize: int('CHUNK_SIZE', 1024 * 1024),

  rabbitmqUrl: env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672',
};
