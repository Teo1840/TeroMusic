// Entrar a una sala: el tope de oyentes no se pasa aunque entren varios a la vez.
process.env.JWT_SECRET = 'secreto-de-prueba';

const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../src/auth');
const { Hub, CLOSE } = require('../src/hub');
const session = require('../src/session');

const ROOM = '22222222-2222-4222-8222-222222222222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Store en memoria. listeners() tarda un poco, como el viaje a Redis: sin candado, todos ven lugar. */
function memoryStore({ maxListeners }) {
  const conns = new Map();
  let lock = Promise.resolve();
  return {
    conns,
    getRoom: async () => ({ id: ROOM, max_listeners: maxListeners }),
    listeners: async () => {
      await sleep(5);
      return [...new Map([...conns.values()].map((u) => [u.id, { user_id: u.id }])).values()];
    },
    addConn: async (roomId, connId, user) => {
      conns.set(connId, user);
    },
    removeConn: async (roomId, connId) => {
      conns.delete(connId);
    },
    withLock: async (roomId, fn) => {
      const run = lock.then(fn);
      lock = run.catch(() => {});
      return run;
    },
    publish: async () => {},
  };
}

function fakeSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data) {
      this.sent.push(JSON.parse(data));
    },
    close(code) {
      this.closedWith = code;
      this.readyState = 3;
    },
  };
}

test('varios entrando a la vez no pasan el tope de oyentes', async () => {
  const store = memoryStore({ maxListeners: 3 });
  const hub = new Hub({ store, getSong: async () => null, checkSession: async () => {} });
  hub.broadcastState = async () => {};

  const sockets = Array.from({ length: 8 }, () => fakeSocket());
  await Promise.all(sockets.map((ws, i) => {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    return hub.authenticate(ws, ROOM, { type: 'auth', token: auth.sign({ sub: id, email: `u${i}@x.com` }) }, null);
  }));

  assert.equal(store.conns.size, 3);
  assert.equal(sockets.filter((ws) => ws.closedWith === CLOSE.FULL).length, 5);
});

test('el mismo usuario en otra pestana entra aunque la sala este llena', async () => {
  const store = memoryStore({ maxListeners: 2 });
  const hub = new Hub({ store, getSong: async () => null, checkSession: async () => {} });
  hub.broadcastState = async () => {};
  const token = (id) => ({ type: 'auth', token: auth.sign({ sub: id, email: 'a@x.com' }) });
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';

  await hub.authenticate(fakeSocket(), ROOM, token(A), null);
  await hub.authenticate(fakeSocket(), ROOM, token(B), null);
  const again = fakeSocket();
  await hub.authenticate(again, ROOM, token(A), null);
  assert.equal(again.closedWith, null);
  assert.equal(store.conns.size, 3);
});

test('si el socket se cierra esperando el candado, no queda ocupando lugar', async () => {
  const store = memoryStore({ maxListeners: 5 });
  const hub = new Hub({ store, getSong: async () => null, checkSession: async () => {} });
  hub.broadcastState = async () => {};
  const ws = fakeSocket();
  const pending = hub.authenticate(ws, ROOM, { type: 'auth', token: auth.sign({ sub: ROOM, email: 'a@x.com' }) }, null);
  ws.readyState = 3; // se corto mientras esperaba
  await pending;
  assert.equal(store.conns.size, 0);
});

// ---------- Sesion revocada (el WebSocket no pasa por el /verify del gateway) ----------

const USER = '00000000-0000-4000-8000-0000000000aa';
const authMessage = (payload = {}) => ({ type: 'auth', token: auth.sign({ sub: USER, email: 'a@x.com', ...payload }) });

function hubWith(checkSession, store = memoryStore({ maxListeners: 5 })) {
  const hub = new Hub({ store, getSong: async () => null, checkSession });
  hub.broadcastState = async () => {};
  return { hub, store };
}

test('entrar con una sesion revocada: 4001 y no ocupa lugar', async () => {
  const { hub, store } = hubWith(async () => {
    throw new session.SessionRevoked('Sesion revocada');
  });
  const ws = fakeSocket();
  await hub.authenticate(ws, ROOM, authMessage(), null);
  assert.equal(ws.closedWith, CLOSE.AUTH);
  assert.equal(store.conns.size, 0);
});

test('si user_service no responde al entrar: 1013 (el front reintenta)', async () => {
  const { hub, store } = hubWith(async () => {
    throw new session.SessionUnavailable('caido');
  });
  const ws = fakeSocket();
  await hub.authenticate(ws, ROOM, authMessage(), null);
  assert.equal(ws.closedWith, CLOSE.TRY_AGAIN);
  assert.equal(store.conns.size, 0);
});

test('mientras escucha: revocada → 4001, vencida → 4002, user_service caido → sigue', async () => {
  let verdict = null;
  const checked = [];
  const { hub } = hubWith(async (token) => {
    checked.push(token);
    if (verdict) throw verdict;
  });
  const join = async (payload) => {
    const ws = fakeSocket();
    await hub.authenticate(ws, ROOM, authMessage(payload), null);
    return ws;
  };

  // Dos pestañas con el mismo token: una sola consulta.
  const a = await join();
  const b = fakeSocket();
  await hub.authenticate(b, ROOM, { type: 'auth', token: a.token }, null);
  checked.length = 0;
  await hub.recheckSessions([a, b]);
  assert.equal(checked.length, 1);
  assert.equal(a.closedWith, null);

  verdict = new session.SessionUnavailable('caido');
  await hub.recheckSessions([a, b]);
  assert.equal(a.closedWith, null);

  verdict = new session.SessionRevoked('Sesion revocada');
  await hub.recheckSessions([a, b]);
  assert.equal(a.closedWith, CLOSE.AUTH);
  assert.equal(b.closedWith, CLOSE.AUTH);

  verdict = null;
  const soon = Math.floor(Date.now() / 1000) + 60;
  const c = await join({ exp: soon });
  hub.now = () => (soon + 1) * 1000; // paso el vencimiento
  await hub.recheckSessions([c]);
  assert.equal(c.closedWith, CLOSE.TOKEN_EXPIRED);
});

test('session.check: 401 es revocada, 200 vale, error de red es "no se sabe"', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ status: 401, ok: false });
    await assert.rejects(session.check('t'), session.SessionRevoked);
    global.fetch = async () => ({ status: 200, ok: true });
    await session.check('t');
    global.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(session.check('t'), session.SessionUnavailable);
    global.fetch = async () => ({ status: 500, ok: false });
    await assert.rejects(session.check('t'), session.SessionUnavailable);
  } finally {
    global.fetch = original;
  }
});
