const config = require('./config');

/**
 * ¿La sesion sigue valiendo? Le pregunta a user_service (GET /verify), igual que el gateway
 * en cada pedido HTTP. Hace falta porque el WebSocket no pasa por el gateway con
 * auth_request: rooms_service valida el JWT por su cuenta, y la firma sola no sabe si la
 * sesion se revoco (cambio de contraseña o cuenta borrada, ver token_version en user_service).
 *
 *   ok             → la sesion vale
 *   SessionRevoked → user_service la rechaza (401/403): hay que echar al usuario
 *   SessionUnavailable → user_service no responde: no se sabe
 */

class SessionRevoked extends Error {}
class SessionUnavailable extends Error {}

async function check(token) {
  if (!config.userServiceUrl) return;
  let response;
  try {
    response = await fetch(`${config.userServiceUrl}/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(config.userServiceTimeoutMs),
    });
  } catch (error) {
    throw new SessionUnavailable(`user_service no responde: ${error.message}`);
  }
  if (response.status === 401 || response.status === 403) throw new SessionRevoked('Sesion revocada');
  if (!response.ok) throw new SessionUnavailable(`user_service respondio ${response.status}`);
}

module.exports = { SessionRevoked, SessionUnavailable, check };
