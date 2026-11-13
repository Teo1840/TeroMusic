const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const amqp = require('amqplib');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const config = require('./config');

const EXCHANGE = 'musicapp.events';
const TYPE = 'room.created.v1';
const RETRY_DELAYS_MS = [500, 1000, 2000];

// Eventos que consume: song.deleted.v1 (sacar la cancion de las salas abiertas).
// Una sola cola para todas las copias del servicio: cada evento lo procesa una sola.
const SONG_DELETED = 'song.deleted.v1';
const QUEUE = 'rooms.q';
const DEAD_EXCHANGE = 'musicapp.dlx';
const DEAD_QUEUE = 'musicapp.dlq';
const RETRY_AFTER_MS = 1000;

// En el repo: ../../../contracts. En la imagen Docker: /app/contracts.
const CONTRACTS = [path.resolve(__dirname, '../../../contracts'), path.resolve(__dirname, '../contracts')]
  .find((dir) => fs.existsSync(dir));
if (!CONTRACTS) throw new Error('No se encontro la carpeta contracts/');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const schema = (file) => JSON.parse(fs.readFileSync(path.join(CONTRACTS, file), 'utf8'));
const validateData = ajv.compile(schema(`events/${TYPE}.schema.json`));
const validateEnvelope = ajv.compile(schema('envelope.schema.json'));
const validateSongDeleted = ajv.compile(schema(`events/${SONG_DELETED}.schema.json`));

let connection = null;
let channel = null;
let consumerChannel = null;
let closing = false;
let songDeletedHandler = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sobre CloudEvents con el data de contracts/events/room.created.v1.schema.json. */
function buildRoomCreated(data, { correlationId, now = new Date() } = {}) {
  if (!validateData(data)) {
    const detail = validateData.errors.map((e) => `${e.instancePath || 'data'} ${e.message}`).join('; ');
    throw new Error(`room.created.v1 no cumple el contrato: ${detail}`);
  }
  const event = {
    specversion: '1.0',
    id: randomUUID(),
    source: '/services/rooms',
    type: TYPE,
    time: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    subject: `room/${data.room_id}`,
    datacontenttype: 'application/json',
    dataschema: `contracts/events/${TYPE}.schema.json`,
    data,
  };
  if (correlationId) event.correlationid = correlationId;
  return event;
}

class InvalidEvent extends Error {}

const errorsOf = (validate) => validate.errors.map((e) => `${e.instancePath || 'data'} ${e.message}`).join('; ');

/** Valida un song.deleted.v1 (sobre + data) y devuelve su data. Lanza InvalidEvent si no cumple. */
function parseSongDeleted(body, routingKey) {
  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    throw new InvalidEvent('JSON invalido');
  }
  if (!validateEnvelope(event)) throw new InvalidEvent(`Sobre invalido: ${errorsOf(validateEnvelope)}`);
  if (event.type !== SONG_DELETED || routingKey !== SONG_DELETED) {
    throw new InvalidEvent(`Tipo inesperado: ${event.type} (routing key ${routingKey})`);
  }
  if (!validateSongDeleted(event.data)) throw new InvalidEvent(`${SONG_DELETED} invalido: ${errorsOf(validateSongDeleted)}`);
  return event.data;
}

/**
 * Procesa una entrega de RabbitMQ:
 *   ok            → ack
 *   invalido      → reject sin reencolar (va a la cola de errores musicapp.dlq)
 *   falla interna → (Redis caido, sala ocupada) se reencola despues de un rato.
 * Sacar una cancion es idempotente: procesar dos veces el mismo evento no cambia nada.
 */
async function handleDelivery(ch, message, handler, { retryAfterMs = RETRY_AFTER_MS } = {}) {
  let data;
  try {
    data = parseSongDeleted(message.content, message.fields.routingKey);
  } catch (error) {
    console.warn(`[events] Descartado a ${DEAD_QUEUE}: ${error.message}`);
    ch.nack(message, false, false);
    return 'dead';
  }
  try {
    await handler(data);
  } catch (error) {
    console.warn(`[events] ${SONG_DELETED} ${data.song_id}: ${error.message}; se reintenta`);
    await sleep(retryAfterMs);
    try {
      ch.nack(message, false, true);
    } catch {
      // Canal cerrado: RabbitMQ lo vuelve a entregar solo.
    }
    return 'retry';
  }
  try {
    ch.ack(message);
  } catch {
    // Canal cerrado: se vuelve a entregar y, como es idempotente, no pasa nada.
  }
  return 'ack';
}

/** Registra quien procesa song.deleted.v1. Llamar antes de connect(). */
function onSongDeleted(handler) {
  songDeletedHandler = handler;
}

async function startConsumer() {
  consumerChannel = await connection.createChannel();
  await consumerChannel.prefetch(10);
  // Mismas declaraciones que metrics_service: el que arranca primero las crea.
  await consumerChannel.assertExchange(DEAD_EXCHANGE, 'topic', { durable: true });
  await consumerChannel.assertQueue(DEAD_QUEUE, { durable: true });
  await consumerChannel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, '#');
  await consumerChannel.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DEAD_EXCHANGE } });
  await consumerChannel.bindQueue(QUEUE, EXCHANGE, SONG_DELETED);
  const ch = consumerChannel;
  ch.on('error', (error) => console.warn(`[events] Canal de consumo: ${error.message}`));
  // Si el broker cierra solo el canal, se cierra la conexion para que connect() rearme todo.
  ch.on('close', () => {
    if (!closing && connection && consumerChannel === ch) connection.close().catch(() => {});
  });
  await ch.consume(QUEUE, (message) => {
    if (message) handleDelivery(ch, message, songDeletedHandler);
  });
  console.log(`[events] Escuchando ${SONG_DELETED} en ${QUEUE}`);
}

async function connect() {
  for (let attempt = 1; !closing; attempt += 1) {
    try {
      connection = await amqp.connect(config.rabbitmqUrl);
      // ConfirmChannel: publish() termina cuando el broker acepto el mensaje.
      channel = await connection.createConfirmChannel();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      connection.on('error', (error) => console.warn(`[events] RabbitMQ: ${error.message}`));
      connection.on('close', () => {
        connection = null;
        channel = null;
        consumerChannel = null;
        if (!closing) {
          console.warn('[events] Conexion con RabbitMQ cerrada; reconectando');
          connect();
        }
      });
      console.log(`[events] Publicando en ${EXCHANGE}/${TYPE}`);
      if (songDeletedHandler) await startConsumer();
      return;
    } catch (error) {
      // Si fallo despues de conectar (ej. al declarar la cola), cerrar antes de reintentar.
      if (connection) {
        const stale = connection;
        connection = null;
        channel = null;
        consumerChannel = null;
        stale.removeAllListeners('close');
        await stale.close().catch(() => {});
      }
      const delay = Math.min(1000 * attempt, 10000);
      console.warn(`[events] RabbitMQ no disponible (${error.message}); reintento en ${delay} ms`);
      await sleep(delay);
    }
  }
}

function publishOnce(event) {
  return new Promise((resolve, reject) => {
    if (!channel) {
      reject(new Error('Sin canal de RabbitMQ'));
      return;
    }
    channel.publish(
      EXCHANGE,
      TYPE,
      Buffer.from(JSON.stringify(event)),
      { contentType: 'application/json', persistent: true, messageId: event.id, type: TYPE },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/** Publica con reintentos. Todos los intentos usan el mismo id. */
async function publish(event) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await publishOnce(event);
      return;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

const isReady = () => channel !== null;

async function close() {
  closing = true;
  if (connection) await connection.close().catch(() => {});
}

module.exports = {
  TYPE, SONG_DELETED, QUEUE, InvalidEvent,
  buildRoomCreated, parseSongDeleted, handleDelivery, onSongDeleted, connect, publish, isReady, close,
};
