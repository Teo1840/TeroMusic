const { randomUUID } = require('node:crypto');

const express = require('express');

const auth = require('./auth');
const commands = require('./commands');
const config = require('./config');
const playback = require('./playback');
const { snapshot } = require('./snapshot');

/**
 * API REST de salas. El gateway ya valido el login, pero igual se verifica el JWT:
 * el servicio necesita saber QUIEN es (para el host) y no confia en headers sueltos.
 *
 * deps: { store, events } (se inyectan para poder testear sin Redis ni RabbitMQ)
 */
function createApp({ store, events, now = Date.now }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));

  // Todo menos /health pide login.
  const requireUser = (req, res, next) => {
    try {
      req.user = auth.userFrom(req);
      return next();
    } catch (error) {
      if (!(error instanceof auth.Unauthorized)) return next(error);
      return res.status(401).json({ detail: error.message });
    }
  };

  const validId = (req, res, next) => (commands.UUID.test(req.params.roomId)
    ? next()
    : res.status(400).json({ detail: 'room_id debe ser un UUID' }));

  app.get('/health', (req, res) => {
    const status = { redis: store.isReady() ? 'ok' : 'down', rabbitmq: events.isReady() ? 'ok' : 'down' };
    const healthy = status.redis === 'ok';
    res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'down', ...status });
  });

  /** Crear sala. Body: { name, visibility?: "public"|"private", max_listeners?: 2..500 } */
  app.post('/rooms', requireUser, async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const visibility = body.visibility ?? 'public';
    const maxListeners = body.max_listeners ?? config.defaultMaxListeners;

    const errors = [];
    if (name.length < 1 || name.length > 80) errors.push('name debe tener entre 1 y 80 caracteres');
    if (!['public', 'private'].includes(visibility)) errors.push('visibility debe ser "public" o "private"');
    if (!Number.isInteger(maxListeners) || maxListeners < 2 || maxListeners > 500) {
      errors.push('max_listeners debe ser un entero entre 2 y 500');
    }
    if (errors.length) return res.status(400).json({ detail: errors.join('; '), errors });

    const room = {
      id: randomUUID(),
      name,
      visibility,
      max_listeners: maxListeners,
      host_id: req.user.id,
      host_name: req.user.name,
      created_at: new Date(now()).toISOString(),
    };

    try {
      await store.createRoom(room);
    } catch (error) {
      return next(error);
    }

    // El evento no frena la creacion: si RabbitMQ falla, la sala existe igual.
    try {
      const event = events.buildRoomCreated(
        { room_id: room.id, host_id: room.host_id, name, visibility, max_listeners: maxListeners },
        { correlationId: req.get('X-Correlation-Id') },
      );
      events.publish(event).catch((error) => console.warn(`[rooms] No se publico room.created: ${error.message}`));
    } catch (error) {
      console.warn(`[rooms] room.created invalido: ${error.message}`);
    }

    return res.status(201).json({ ...room, cohosts: [], playback: playback.initial() });
  });

  /** Salas publicas con cuantos escuchan y que suena. */
  app.get('/rooms', requireUser, async (req, res, next) => {
    try {
      const rooms = await store.listPublic();
      const result = await Promise.all(rooms.map(async (room) => {
        const [listeners, pb] = await Promise.all([store.listeners(room.id), store.getPlayback(room.id)]);
        return { ...room, listeners: listeners.length, now_playing: pb.title, playing: pb.playing };
      }));
      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });

  /** Una sala (tambien las privadas: se entra con el link). */
  app.get('/rooms/:roomId', requireUser, validId, async (req, res, next) => {
    try {
      const state = await snapshot(store, req.params.roomId, now());
      if (!state) return res.status(404).json({ detail: 'Sala no encontrada' });
      return res.json(state);
    } catch (error) {
      return next(error);
    }
  });

  /** Cerrar sala: solo el anfitrion. Desconecta a todos. */
  app.delete('/rooms/:roomId', requireUser, validId, async (req, res, next) => {
    try {
      const room = await store.getRoom(req.params.roomId);
      if (!room) return res.status(404).json({ detail: 'Sala no encontrada' });
      if (room.host_id !== req.user.id) return res.status(403).json({ detail: 'Solo el anfitrion puede cerrar la sala' });
      await store.deleteRoom(room.id);
      await store.publish(room.id, { type: 'closed' });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ detail: 'JSON invalido' });
    if (error.type === 'entity.too.large') return res.status(413).json({ detail: 'Body demasiado grande' });
    console.error(`[rooms] ${req.method} ${req.originalUrl}: ${error.stack || error}`);
    return res.status(503).json({ detail: 'Servicio no disponible' });
  });

  return app;
}

module.exports = { createApp };
