const playback = require('./playback');

const { CommandError } = playback;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Roles de una sala:
 *   host     → la creo. Controla la musica, nombra/quita coanfitriones y puede cerrarla.
 *   cohost   → nombrado por el host. Controla la musica.
 *   listener → escucha. No controla nada.
 */
function roleOf(room, cohosts, userId) {
  if (room.host_id === userId) return 'host';
  if (cohosts.includes(userId)) return 'cohost';
  return 'listener';
}

const canControl = (role) => role === 'host' || role === 'cohost';

const CONTROL = new Set(['play', 'pause', 'seek', 'set_song']);
const ROLES = new Set(['promote', 'demote']);

/**
 * Aplica un comando que mando un cliente por el WebSocket.
 * Devuelve lo que cambio: { playback } o { promote | demote: user_id }.
 * Lanza CommandError si el comando no es valido o el usuario no tiene permiso.
 *
 * ctx: { room, cohosts, playback, userId, now, getSong, startDelayMs }
 */
async function apply(message, ctx) {
  const type = message?.type;
  const role = roleOf(ctx.room, ctx.cohosts, ctx.userId);

  if (CONTROL.has(type)) {
    if (!canControl(role)) throw new CommandError('Solo el anfitrion y los coanfitriones controlan la musica');

    switch (type) {
      case 'play':
        return { playback: playback.play(ctx.playback, ctx.now) };
      case 'pause':
        return { playback: playback.pause(ctx.playback, ctx.now) };
      case 'seek':
        return { playback: playback.seek(ctx.playback, message.position_ms, ctx.now) };
      case 'set_song': {
        if (typeof message.song_id !== 'string' || !UUID.test(message.song_id)) {
          throw new CommandError('song_id debe ser un UUID');
        }
        const song = await ctx.getSong(message.song_id);
        if (!song) throw new CommandError('Cancion no encontrada');
        if (song.status !== 'PUBLICADO') throw new CommandError('La cancion todavia no esta publicada');
        return { playback: playback.setSong({ ...song, id: message.song_id }, ctx.now, ctx.startDelayMs) };
      }
      default:
        break;
    }
  }

  if (ROLES.has(type)) {
    if (role !== 'host') throw new CommandError('Solo el anfitrion nombra o quita coanfitriones');
    if (typeof message.user_id !== 'string' || !UUID.test(message.user_id)) {
      throw new CommandError('user_id debe ser un UUID');
    }
    if (message.user_id === ctx.room.host_id) throw new CommandError('El anfitrion no puede ser coanfitrion');
    return type === 'promote' ? { promote: message.user_id } : { demote: message.user_id };
  }

  throw new CommandError(`Comando desconocido: ${type}`);
}

module.exports = { CommandError, UUID, roleOf, canControl, apply };
