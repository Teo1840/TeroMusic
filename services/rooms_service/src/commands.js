const playback = require('./playback');
const queue = require('./queue');

const { CommandError } = playback;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roles de una sala:
 *   host     → la creo. Controla la musica y la cola, nombra/quita coanfitriones y puede cerrarla.
 *   cohost   → nombrado por el host. Controla la musica y la cola.
 *   listener → escucha y puede sugerir canciones.
 */
function roleOf(room, cohosts, userId) {
  if (room.host_id === userId) return 'host';
  if (cohosts.includes(userId)) return 'cohost';
  return 'listener';
}

const canControl = (role) => role === 'host' || role === 'cohost';

// Comandos que solo pueden usar anfitrion y coanfitriones.
const CONTROL = new Set([
  'play', 'pause', 'seek', 'set_song', 'next',
  'queue_add', 'queue_remove', 'queue_move', 'suggestion_accept', 'suggestion_reject',
]);
const ROLES = new Set(['promote', 'demote']);

function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new CommandError(`${field} debe ser un UUID`);
}

/** Busca la cancion en el catalogo: tiene que existir y estar PUBLICADO. */
async function publishedSong(ctx, songId) {
  requireUuid(songId, 'song_id');
  const song = await ctx.getSong(songId);
  if (!song) throw new CommandError('Cancion no encontrada');
  if (song.status !== 'PUBLICADO') throw new CommandError('La cancion todavia no esta publicada');
  return { ...song, id: songId };
}

/** Agrega a la cola. Si no esta sonando nada, arranca enseguida. */
function enqueue(ctx, item) {
  const newQueue = queue.append(ctx.queue, item);
  if (queue.isIdle(ctx.playback, ctx.now)) return queue.advance(newQueue, ctx.now, ctx.startDelayMs);
  return { queue: newQueue };
}

/**
 * Aplica un comando que mando un cliente por el WebSocket.
 * Devuelve solo lo que cambio: { playback?, queue?, suggestions?, promote?, demote? }.
 * Un objeto vacio significa "no hay nada que hacer" (no se avisa a la sala).
 * Lanza CommandError si el comando no es valido o el usuario no tiene permiso.
 *
 * ctx: { room, cohosts, user: {id, name}, playback, queue, suggestions, now, getSong, startDelayMs }
 */
async function apply(message, rawCtx) {
  const ctx = { queue: [], suggestions: [], ...rawCtx };
  ctx.user = ctx.user ?? { id: ctx.userId, name: ctx.userId };
  const type = message?.type;
  const role = roleOf(ctx.room, ctx.cohosts, ctx.user.id);

  if (CONTROL.has(type) && !canControl(role)) {
    throw new CommandError('Solo el anfitrion y los coanfitriones controlan la musica');
  }

  switch (type) {
    // --- Reproduccion ---
    case 'play':
      return { playback: playback.play(ctx.playback, ctx.now) };
    case 'pause':
      return { playback: playback.pause(ctx.playback, ctx.now) };
    case 'seek':
      return { playback: playback.seek(ctx.playback, message.position_ms, ctx.now) };
    case 'set_song': {
      // "Poner ahora": reemplaza la actual; la cola sigue igual.
      const song = await publishedSong(ctx, message.song_id);
      return { playback: playback.setSong(song, ctx.now, ctx.startDelayMs) };
    }
    case 'next': {
      const result = queue.advance(ctx.queue, ctx.now, ctx.startDelayMs);
      if (!result) throw new CommandError('No hay canciones en la cola');
      return result;
    }

    // --- Cola ---
    case 'queue_add': {
      const song = await publishedSong(ctx, message.song_id);
      return enqueue(ctx, queue.makeItem(song, ctx.user));
    }
    case 'queue_remove':
      requireUuid(message.item_id, 'item_id');
      return { queue: queue.remove(ctx.queue, message.item_id) };
    case 'queue_move':
      requireUuid(message.item_id, 'item_id');
      return { queue: queue.move(ctx.queue, message.item_id, message.to_index) };

    // --- Sugerencias ---
    case 'suggest': {
      const song = await publishedSong(ctx, message.song_id);
      const item = queue.makeItem(song, ctx.user);
      // Quien controla la musica no necesita pedir permiso: va directo a la cola.
      if (canControl(role)) return enqueue(ctx, item);
      return { suggestions: queue.suggest(ctx.suggestions, ctx.queue, item) };
    }
    case 'suggestion_accept': {
      requireUuid(message.item_id, 'item_id');
      const item = ctx.suggestions.find((s) => s.item_id === message.item_id);
      const suggestions = queue.remove(ctx.suggestions, message.item_id);
      return { ...enqueue(ctx, item), suggestions };
    }
    case 'suggestion_reject':
      requireUuid(message.item_id, 'item_id');
      return { suggestions: queue.remove(ctx.suggestions, message.item_id) };

    // --- Fin de cancion ---
    case 'ended': {
      // Lo avisa cualquier navegador, pero se verifica con el reloj del servidor.
      // Si ya cambio la cancion (otro aviso llego antes), no hace nada.
      const pb = ctx.playback;
      if (message.song_id !== pb.song_id || message.updated_at_ms !== pb.updated_at_ms) return {};
      if (!pb.playing || !queue.isOver(pb, ctx.now)) return {};
      return queue.advance(ctx.queue, ctx.now, ctx.startDelayMs) ?? { playback: queue.stopAtEnd(pb, ctx.now) };
    }

    default:
      break;
  }

  if (ROLES.has(type)) {
    if (role !== 'host') throw new CommandError('Solo el anfitrion nombra o quita coanfitriones');
    requireUuid(message.user_id, 'user_id');
    if (message.user_id === ctx.room.host_id) throw new CommandError('El anfitrion no puede ser coanfitrion');
    return type === 'promote' ? { promote: message.user_id } : { demote: message.user_id };
  }

  throw new CommandError(`Comando desconocido: ${type}`);
}

module.exports = { CommandError, UUID, roleOf, canControl, apply };
