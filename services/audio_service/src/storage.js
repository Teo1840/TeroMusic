const Minio = require('minio');

const config = require('./config');

const client = new Minio.Client(config.minio);

function keyFor(songId) {
  return config.keyTemplate.replaceAll('{song_id}', songId);
}

/** Tamano y tipo del archivo procesado, o null si no existe. */
async function stat(songId) {
  try {
    const info = await client.statObject(config.bucket, keyFor(songId));
    const contentType = info.metaData?.['content-type'];
    return {
      size: info.size,
      contentType: contentType && contentType !== 'application/octet-stream' ? contentType : 'audio/mpeg',
    };
  } catch (error) {
    if (['NotFound', 'NoSuchKey', 'NoSuchBucket'].includes(error.code)) return null;
    throw error;
  }
}

/** Lee el fragmento numero `num` (el ultimo puede ser mas corto). */
async function readChunk(songId, num, size) {
  const offset = num * config.chunkSize;
  const length = Math.min(config.chunkSize, size - offset);
  const stream = await client.getPartialObject(config.bucket, keyFor(songId), offset, length);
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

async function ping() {
  await client.bucketExists(config.bucket);
}

module.exports = { client, keyFor, stat, readChunk, ping };
