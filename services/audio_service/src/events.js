const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const amqp = require('amqplib');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const config = require('./config');

const EXCHANGE = 'musicapp.events';
const TYPE = 'song.played.v1';
const RETRY_DELAYS_MS = [500, 1000, 2000];

// En el repo: ../../../contracts. En la imagen Docker: /app/contracts.
const CONTRACTS = [path.resolve(__dirname, '../../../contracts'), path.resolve(__dirname, '../contracts')]
  .find((dir) => fs.existsSync(dir));
if (!CONTRACTS) throw new Error('No se encontro la carpeta contracts/');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateData = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(CONTRACTS, `events/${TYPE}.schema.json`), 'utf8')),
);

let connection = null;
let channel = null;
let closing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class InvalidEvent extends Error {
  constructor(errors) {
    super('El evento no cumple el contrato');
    this.errors = errors;
  }
}

/** Errores de validacion legibles: "/listened_sec must be >= 0". */
function describe(errors) {
  return errors.map((e) => {
    if (e.keyword === 'additionalProperties') return `campo no permitido: ${e.params.additionalProperty}`;
    if (e.keyword === 'required') return `falta ${e.params.missingProperty}`;
    return `${e.instancePath.slice(1) || 'data'} ${e.message}`;
  });
}

/**
 * Sobre CloudEvents con el data de contracts/events/song.played.v1.schema.json.
 * Lanza InvalidEvent si el data no cumple el schema.
 */
function buildSongPlayed(data, { correlationId, now = new Date() } = {}) {
  if (!validateData(data)) throw new InvalidEvent(describe(validateData.errors));
  const event = {
    specversion: '1.0',
    id: randomUUID(),
    source: '/services/audio',
    type: TYPE,
    time: now.toISOString(),
    subject: `song/${data.song_id}`,
    datacontenttype: 'application/json',
    dataschema: `contracts/events/${TYPE}.schema.json`,
    data,
  };
  if (correlationId) event.correlationid = correlationId;
  return event;
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
        if (!closing) {
          console.warn('[events] Conexion con RabbitMQ cerrada; reconectando');
          connect();
        }
      });
      console.log(`[events] Publicando en ${EXCHANGE}/${TYPE}`);
      return;
    } catch (error) {
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
      {
        contentType: 'application/json',
        persistent: true,
        messageId: event.id,
        type: TYPE,
      },
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

function isReady() {
  return channel !== null;
}

async function close() {
  closing = true;
  if (connection) await connection.close().catch(() => {});
}

module.exports = { EXCHANGE, TYPE, InvalidEvent, buildSongPlayed, connect, publish, isReady, close };
