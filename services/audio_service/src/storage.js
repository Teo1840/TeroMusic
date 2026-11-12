const Minio = require('minio');

const config = require('./config');

const client = new Minio.Client(config.minio);

/** Tamano y tipo del archivo procesado, o null si no existe. */
async function stat(key) {
  try {
    const info = await client.statObject(config.bucket, key);
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
async function readChunk(key, num, size) {
  const offset = num * config.chunkSize;
  const length = Math.min(config.chunkSize, size - offset);
  const stream = await client.getPartialObject(config.bucket, key, offset, length);
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

/** Archivo chico entero (ej. waveform.json), o null si no existe. */
async function readSmall(key) {
  try {
    const stream = await client.getObject(config.bucket, key);
    const parts = [];
    for await (const part of stream) parts.push(part);
    return Buffer.concat(parts);
  } catch (error) {
    if (['NotFound', 'NoSuchKey', 'NoSuchBucket'].includes(error.code)) return null;
    throw error;
  }
}

async function ping() {
  await client.bucketExists(config.bucket);
}

module.exports = { client, stat, readChunk, readSmall, ping };
