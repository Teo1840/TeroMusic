const { randomUUID } = require('node:crypto');

const amqp = require('amqplib');

const config = require('./config');

const EXCHANGE = 'musicapp.events';
const TYPE = 'song.played.v1';
const RETRY_DELAYS_MS = [500, 1000, 2000];

let connection = null;
let channel = null;
let closing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sobre CloudEvents de contracts/events/song.played.v1.schema.json. */
function buildSongPlayed({ songId, userId, correlationId, now = new Date() }) {
  const time = now.toISOString();
  const event = {
    specversion: '1.0',
    id: randomUUID(),
    source: '/services/audio',
    type: TYPE,
    time,
    subject: `song/${songId}`,
    datacontenttype: 'application/json',
    dataschema: `contracts/events/${TYPE}.schema.json`,
    data: {
      song_id: songId,
      user_id: userId,
      started_at: time,
      // Se publica al iniciar, por eso todavia no hay segundos escuchados.
      listened_sec: 0,
      client: 'web',
    },
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

/**
 * Fire-and-forget: devuelve enseguida y publica en segundo plano,
 * sin retrasar la entrega del audio. Los errores solo van al log.
 */
function publishSongPlayed(params) {
  const event = buildSongPlayed(params);
  setImmediate(() => {
    publish(event)
      .then(() => console.log(`[events] ${TYPE} song_id=${params.songId} id=${event.id}`))
      .catch((error) => console.error(`[events] No se pudo publicar ${TYPE}: ${error.message}`));
  });
  return event;
}

function isReady() {
  return channel !== null;
}

async function close() {
  closing = true;
  if (connection) await connection.close().catch(() => {});
}

module.exports = { EXCHANGE, TYPE, buildSongPlayed, connect, publishSongPlayed, isReady, close };
