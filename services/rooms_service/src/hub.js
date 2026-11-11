const { randomUUID } = require('node:crypto');

const { WebSocketServer } = require('ws');

const auth = require('./auth');
const commands = require('./commands');
const config = require('./config');
const { snapshot } = require('./snapshot');

/**
 * WebSockets de las salas.
 *
 * Conexion: ws://.../rooms/{room_id}/ws
 *   1. El cliente manda {type:"auth", token:"<jwt>"} (el navegador no puede mandar
 *      headers en un WebSocket, y asi el token no queda en la URL ni en los logs).
 *   2. El servidor responde {type:"welcome"} y despues {type:"state"} a toda la sala.
 *   3. Comandos: play, pause, seek, set_song, promote, demote, ping.
 *
 * Cada cambio se guarda en Redis y se publica en el canal rooms:events. Todas las
 * copias del servicio lo reciben y lo reenvian a sus propias conexiones de esa sala.
 */

// Codigos de cierre propios (4000-4999 estan reservados para aplicaciones).
const CLOSE = {
  AUTH: 4001,
  FULL: 4003,
  NOT_FOUND: 4004,
  ROOM_CLOSED: 4010,
};

const PATH = /^\/rooms\/([0-9a-f-]{36})\/ws$/i;

class Hub {
  constructor({ store, getSong, now = Date.now }) {
    this.store = store;
    this.getSong = getSong;
    this.now = now;
    this.rooms = new Map(); // room_id → Set de sockets de ESTA copia
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  }

  /** Engancha el WebSocket al servidor HTTP de express. */
  attach(server) {
    server.on('upgrade', (req, socket, head) => {
      const match = PATH.exec(new URL(req.url, 'http://x').pathname);
      if (!match || !commands.UUID.test(match[1])) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, match[1]));
    });

    // Detecta conexiones muertas (wifi cortado, laptop suspendida).
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, config.wsHeartbeatMs);
    this.heartbeat.unref();
  }

  async start() {
    await this.store.subscribe((roomId, payload) => this.deliver(roomId, payload));
  }

  /** Reenvia un mensaje a las conexiones de esta copia que estan en la sala. */
  deliver(roomId, payload) {
    const sockets = this.rooms.get(roomId);
    if (!sockets) return;
    const message = payload.type === 'state' ? { ...payload, server_time: this.now() } : payload;
    const data = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(data);
      if (payload.type === 'closed') ws.close(CLOSE.ROOM_CLOSED, 'Sala cerrada');
    }
  }

  /** Manda el estado actual de la sala a todos (en todas las copias). */
  async broadcastState(roomId) {
    const state = await snapshot(this.store, roomId, this.now());
    if (state) await this.store.publish(roomId, { type: 'state', ...state });
  }

  onConnection(ws, roomId) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const authTimer = setTimeout(() => ws.close(CLOSE.AUTH, 'Falta autenticacion'), config.wsAuthTimeoutMs);
    // Los mensajes se procesan de a uno para que no se pisen.
    let queue = Promise.resolve();

    ws.on('message', (raw) => {
      queue = queue.then(() => this.onMessage(ws, roomId, raw, authTimer)).catch((error) => {
        console.error(`[hub] ${roomId}: ${error.stack || error}`);
        send(ws, { type: 'error', detail: 'Error interno' });
      });
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!ws.connId) return;
      this.rooms.get(roomId)?.delete(ws);
      if (this.rooms.get(roomId)?.size === 0) this.rooms.delete(roomId);
      this.store.removeConn(roomId, ws.connId)
        .then(() => this.broadcastState(roomId))
        .catch((error) => console.warn(`[hub] Al desconectar: ${error.message}`));
    });
  }

  async onMessage(ws, roomId, raw, authTimer) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', detail: 'JSON invalido' });
      return;
    }

    // Sincronizacion de relojes: el cliente mide la ida y vuelta.
    if (message.type === 'ping') {
      send(ws, { type: 'pong', t: message.t, server_time: this.now() });
      return;
    }

    if (!ws.user) {
      await this.authenticate(ws, roomId, message, authTimer);
      return;
    }

    const room = await this.store.getRoom(roomId);
    if (!room) {
      ws.close(CLOSE.NOT_FOUND, 'La sala ya no existe');
      return;
    }
    const [cohosts, current] = await Promise.all([this.store.getCohosts(roomId), this.store.getPlayback(roomId)]);

    let change;
    try {
      change = await commands.apply(message, {
        room,
        cohosts,
        playback: current,
        userId: ws.user.id,
        now: this.now(),
        getSong: this.getSong,
        startDelayMs: config.startDelayMs,
      });
    } catch (error) {
      if (!(error instanceof commands.CommandError)) throw error;
      send(ws, { type: 'error', detail: error.message });
      return;
    }

    if (change.playback) await this.store.setPlayback(roomId, change.playback);
    if (change.promote) await this.store.addCohost(roomId, change.promote);
    if (change.demote) await this.store.removeCohost(roomId, change.demote);
    await this.store.touch(roomId);
    await this.broadcastState(roomId);
  }

  async authenticate(ws, roomId, message, authTimer) {
    if (message.type !== 'auth') {
      ws.close(CLOSE.AUTH, 'El primer mensaje tiene que ser {type:"auth"}');
      return;
    }
    let user;
    try {
      user = auth.userFromToken(message.token);
    } catch (error) {
      ws.close(CLOSE.AUTH, error.message.slice(0, 100));
      return;
    }

    const room = await this.store.getRoom(roomId);
    if (!room) {
      ws.close(CLOSE.NOT_FOUND, 'La sala no existe');
      return;
    }
    const present = await this.store.listeners(roomId);
    const already = present.some((l) => l.user_id === user.id);
    if (!already && present.length >= room.max_listeners) {
      ws.close(CLOSE.FULL, 'La sala esta llena');
      return;
    }

    clearTimeout(authTimer);
    ws.user = user;
    ws.connId = randomUUID();
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId).add(ws);
    await this.store.addConn(roomId, ws.connId, user);

    send(ws, { type: 'welcome', user: { user_id: user.id, name: user.name }, server_time: this.now() });
    await this.broadcastState(roomId);
  }

  /** Al apagar: cierra las conexiones (los clientes se reconectan a otra copia). */
  async close() {
    clearInterval(this.heartbeat);
    for (const ws of this.wss.clients) ws.close(1001, 'Servidor reiniciando');
  }
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

module.exports = { Hub, CLOSE };
