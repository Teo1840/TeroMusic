# rooms_service: salas en vivo

Escucha colectiva y sincronizada: varias personas escuchan **la misma canción, en el mismo
segundo**, cada una desde su dispositivo. Tiene una **cola compartida**: cuando termina una
canción, arranca sola la siguiente para todos. Node.js + Express + WebSockets (`ws`), estado en
Redis y evento `room.created.v1` en RabbitMQ.

```
docker compose up -d --build rooms_service
```

API en http://localhost:8006 (`ROOMS_PORT`). Desde el front, todo pasa por el gateway:
REST en `/api/v1/rooms` y WebSocket en `/api/v1/ws/rooms/{room_id}`.

---

## Roles

| Rol | Quién | Puede |
|---|---|---|
| **Anfitrión** (`host`) | Quien creó la sala | Controlar la música y la cola, nombrar y quitar coanfitriones, cerrar la sala |
| **Coanfitrión** (`cohost`) | Nombrado por el anfitrión | Controlar la música (play, pausa, adelantar, cambiar de canción) y la cola (agregar, reordenar, sacar, aceptar o rechazar sugerencias) |
| **Oyente** (`listener`) | Cualquiera que entra | Escuchar, ajustar su propio volumen y **sugerir** canciones |

Los permisos los controla el servidor ([src/commands.js](src/commands.js)), no el front:
un oyente que mande `play` a mano recibe un error.

Aparte de los roles de cada sala, un **admin de la plataforma** (rol `admin` de user_service, que
llega en `X-User-Role` desde el gateway) puede cerrar cualquier sala.

El tope de oyentes (`max_listeners`) se respeta aunque entren muchos a la vez: contar quién está y
anotar la conexión nueva se hace con el candado de la sala (el mismo de los comandos), así que
dos que entran juntos con un solo lugar libre no pasan los dos, aunque vengan por copias distintas
del servicio.

## Visibilidad

- **Pública:** aparece en la lista (`GET /rooms`).
- **Privada:** no aparece. Se entra solo con el link (`/rooms/{id}`).

## Cola y sugerencias

```
 Sonando ahora          A continuación (cola)                Sugerencias
┌──────────────┐     ┌─────┬─────┬─────┐          ┌───────────────────────┐
│  Canción A   │ ◄── │  B  │  C  │  D  │ ◄─ acepta ─│ E (sugerida por Lu)   │
└──────────────┘     └─────┴─────┴─────┘          └───────────────────────┘
   al terminar,         anfitrión/coanfitrión            cualquier oyente
   arranca B            agrega, reordena, saca           sugiere (hasta 3)
```

- **Agregar a la cola** (`queue_add`): va al final. Si no suena nada, arranca enseguida.
- **Poner ahora** (`set_song`): reemplaza la canción actual. La cola no cambia.
- **Siguiente** (`next`): salta a la primera de la cola.
- **Al terminar una canción** arranca sola la siguiente. Si la cola está vacía, la sala queda
  en pausa al final de la canción.
- **Sugerencias:** un oyente propone una canción y el anfitrión o un coanfitrión la **acepta**
  (pasa al final de la cola, con el nombre de quien la sugirió) o la **rechaza**. Límites:
  - no se puede sugerir una canción que ya está en la cola o ya fue sugerida;
  - cada oyente puede tener hasta 3 sugerencias pendientes;
  - si quien "sugiere" es anfitrión o coanfitrión, va directo a la cola.
- La misma canción puede estar dos veces en la cola: cada entrada tiene su propio `item_id`.
- Cada entrada (y lo que suena, en `playback`) trae `artist_id` y `artist_name` del catálogo.
- **Canción borrada:** cuando el artista borra una canción, catalog_service publica
  `song.deleted.v1`. rooms_service lo consume (cola `rooms.q`) y la saca de la cola y las
  sugerencias de todas las salas abiertas. Si era la que sonaba, pasa a la siguiente; si la
  cola estaba vacía, la sala queda sin canción. Las salas cambiadas reciben un `state` nuevo.
  Es idempotente (repetir el evento no cambia nada) y, con varias copias del servicio, cada
  evento lo procesa una sola. Un evento inválido va a `musicapp.dlq`; si falla Redis, se reintenta.
- Límites: 100 canciones en la cola y 50 sugerencias pendientes por sala.

### ¿Quién avisa que terminó la canción?

El servidor no tiene un temporizador por sala: con varias copias del servicio corriendo,
habría que coordinar cuál lo dispara, y si esa copia se reinicia se perdería. En cambio:

1. Cada navegador, al llegar al final según el reloj del servidor, manda
   `{type:"ended", song_id, updated_at_ms}`.
2. El servidor **verifica con su propio reloj** que la canción terminó de verdad (con 1 s de
   margen). Un oyente no puede saltear canciones mandando `ended` antes de tiempo.
3. Si varios navegadores avisan a la vez, **solo el primero avanza**. El comando se ejecuta
   con un **candado en Redis** (`room:{id}:lock`). Los que llegan después traen un
   `song_id` o `updated_at_ms` viejo y se ignoran.

Si no queda nadie conectado, nadie avisa y la sala no avanza, lo cual tiene sentido: no hay
nadie escuchando.

---

## API REST

Todas las rutas piden `Authorization: Bearer <jwt>`, menos `/health`.

### `POST /rooms`: crear sala

```json
{ "name": "Viernes", "visibility": "public", "max_listeners": 20 }
```

- `name`: entre 1 y 80 caracteres. `visibility`: `public` (predeterminado) o `private`.
  `max_listeners`: de 2 a 500 (predeterminado 50).
- Responde `201` con la sala. Quien la crea es el anfitrión.
- Publica `room.created.v1`: notificaciones le avisa al anfitrión "Tu sala X fue creada".
  Si RabbitMQ está caído, la sala se crea igual.
- Errores: `400` (datos inválidos) y `401`.

### `GET /rooms`: salas públicas

```json
[{ "id": "…", "name": "Viernes", "host_name": "ana", "listeners": 3, "max_listeners": 20,
   "now_playing": "Tonada 8-bit", "playing": true, "visibility": "public", "created_at": "…" }]
```

### `GET /rooms/{id}`: estado completo de una sala

Devuelve lo mismo que el mensaje `state` del WebSocket (ver abajo). Sirve también para salas
privadas. Errores: `400` (id inválido) y `404`.

### `DELETE /rooms/{id}`: cerrar sala

El anfitrión o un admin (`403` si no). Borra la sala y **desconecta a todos** con el código `4010`.
Responde `204`.

---

## WebSocket: `/rooms/{id}/ws`

Por el gateway: `ws://localhost:5173/api/v1/ws/rooms/{id}`.

### 1. Autenticación

El navegador no puede mandar headers en un WebSocket. Por eso el **primer mensaje** tiene
que ser el JWT:

```json
{ "type": "auth", "token": "<jwt>" }
```

Así el token no queda en la URL ni en los logs del gateway. Si no llega en 5 segundos, o es
inválido, el servidor cierra la conexión con `4001`.

### 2. Mensajes del cliente

| `type` | Campos | Quién | Qué hace |
|---|---|---|---|
| `auth` | `token` | todos | Primer mensaje (ver arriba) |
| `ping` | `t` (hora del cliente) | todos | Medir el reloj del servidor (responde `pong`) |
| `play` | — | anfitrión, coanfitrión | Reanuda. Si la canción terminó, vuelve a empezar |
| `pause` | — | anfitrión, coanfitrión | Pausa en la posición actual |
| `seek` | `position_ms` | anfitrión, coanfitrión | Salta a esa posición |
| `set_song` | `song_id` | anfitrión, coanfitrión | **Poner ahora:** cambia de canción (tiene que estar PUBLICADO en el catálogo). La cola no cambia |
| `next` | — | anfitrión, coanfitrión | Salta a la primera de la cola. Error si está vacía |
| `queue_add` | `song_id` | anfitrión, coanfitrión | Agrega al final de la cola. Si no suena nada, arranca |
| `queue_remove` | `item_id` | anfitrión, coanfitrión | Saca de la cola |
| `queue_move` | `item_id`, `to_index` | anfitrión, coanfitrión | Mueve a esa posición (0 = la próxima) |
| `suggest` | `song_id` | todos | Sugiere una canción. Si la manda anfitrión o coanfitrión, va directo a la cola |
| `suggestion_accept` | `item_id` | anfitrión, coanfitrión | Pasa la sugerencia al final de la cola |
| `suggestion_reject` | `item_id` | anfitrión, coanfitrión | Descarta la sugerencia |
| `ended` | `song_id`, `updated_at_ms` | todos | "Terminó la canción". El servidor lo verifica (ver "Cola y sugerencias") |
| `promote` | `user_id` | anfitrión | Nombra coanfitrión |
| `demote` | `user_id` | anfitrión | Quita coanfitrión |

### 3. Mensajes del servidor

| `type` | Cuándo | Contenido |
|---|---|---|
| `welcome` | Al autenticarse | `user` (`user_id`, `name`) y `server_time` |
| `state` | Al entrar alguien, salir alguien o cambiar algo | `room` (con `cohosts`), `playback`, `queue`, `suggestions`, `listeners` y `server_time` |
| `pong` | Respuesta a `ping` | `t` (el mismo que mandó el cliente) y `server_time` |
| `error` | Comando inválido o sin permiso | `detail` |
| `closed` | El anfitrión cerró la sala | (y después se cierra la conexión) |

Ejemplo de `state`:

```json
{
  "type": "state",
  "room": { "id": "…", "name": "Viernes", "host_id": "…", "cohosts": ["…"], "max_listeners": 20, "visibility": "public" },
  "playback": { "song_id": "…", "title": "Tonada 8-bit", "duration_sec": 1.8,
                "playing": true, "position_ms": 0, "updated_at_ms": 1794407935000 },
  "queue": [{ "item_id": "…", "song_id": "…", "title": "SmokeTest", "duration_sec": 3,
              "added_by": { "user_id": "…", "name": "ana" } }],
  "suggestions": [{ "item_id": "…", "song_id": "…", "title": "crazy frog", "duration_sec": 180,
                    "added_by": { "user_id": "…", "name": "juan" } }],
  "listeners": [{ "user_id": "…", "name": "ana" }, { "user_id": "…", "name": "juan" }],
  "server_time": 1794407934120
}
```

### 4. Códigos de cierre

| Código | Motivo | ¿El front reintenta? |
|---|---|---|
| `4001` | Sin autenticación o token inválido | No |
| `4003` | La sala está llena (`max_listeners`) | No |
| `4004` | La sala no existe | No |
| `4010` | El anfitrión (o un admin) cerró la sala | No |
| `1013` | La sala estaba ocupada (candado) y no se pudo entrar | Sí |
| otro | Corte de red, reinicio del servidor | Sí, con espera creciente de 1 s a 10 s |

---

## Cómo se sincroniza

**1. El servidor no manda la posición segundo a segundo.** Guarda una "foto": en qué
milisegundo estaba la canción (`position_ms`) en un instante dado (`updated_at_ms`) y si está
sonando. Con eso, cualquiera calcula la posición actual:

```
posición = position_ms + (hora_servidor_ahora − updated_at_ms)    si está sonando
posición = position_ms                                             si está en pausa
```

Por eso solo hay mensajes cuando alguien hace algo (play, pausa, adelantar, cambiar de canción),
no mientras la canción avanza ([src/playback.js](src/playback.js)).

**2. Cada navegador aprende la hora del servidor.** Los relojes de las computadoras no
coinciden. El cliente manda `ping` con su hora y el servidor responde con la suya:

```
diferencia = hora_servidor + (ida_y_vuelta / 2) − hora_cliente
```

Se queda con la medición de menor ida y vuelta, que es la más precisa, y repite cada 10 s
([frontend/src/lib/room.js](../../frontend/src/lib/room.js)).

**3. Cada 250 ms el reproductor se corrige solo** ([frontend/src/pages/Room.jsx](../../frontend/src/pages/Room.jsx)).
Usa la **mediana de las últimas 5 mediciones**, porque en celulares `currentTime` es poco preciso:

| Desfase | Corrección |
|---|---|
| hasta 150 ms | Nada (no se nota al oído) |
| más de 150 ms | Acelera o frena un 5 % hasta bajar de 30 ms. No se nota al oído |
| más de 1 s | Salta directo a la posición correcta |

- **Histéresis.** Empieza a corregir a los 150 ms y recién deja de hacerlo por debajo de 30 ms.
  Si cambiara de velocidad cada vez que el desfase cruza un único umbral, el audio se trabaría.
- **Espera de 2 s** después de un salto, de arrancar o de un cambio del anfitrión, para que el
  audio se acomode antes de volver a medir. Tampoco mide mientras el audio está cargando.
- La sala muestra el desfase en vivo ("Sincronización: en sincronía (+12 ms)").

**4. Margen al cambiar de canción.** `set_song` programa el arranque 1,5 s en el futuro
(`updated_at_ms = ahora + 1500`). Así todos los navegadores alcanzan a cargar el audio y
empiezan juntos.

**5. Autoplay.** Los navegadores no dejan reproducir sonido sin que el usuario toque algo.
Si lo bloquean, aparece el botón **"Activar audio"**.

---

## Estado en Redis y varias copias del servicio

El servicio **no guarda estado propio**: todo está en Redis, que tiene `appendonly` activado
y por eso sobrevive a un reinicio ([src/store.js](src/store.js)).

| Clave | Tipo | Contenido |
|---|---|---|
| `room:{id}` | string (JSON) | Nombre, visibilidad, anfitrión, máximo de oyentes |
| `room:{id}:cohosts` | SET | `user_id` de los coanfitriones |
| `room:{id}:playback` | string (JSON) | Estado de reproducción |
| `room:{id}:queue` | string (JSON) | Cola "a continuación" |
| `room:{id}:suggestions` | string (JSON) | Sugerencias pendientes |
| `room:{id}:lock` | string con TTL de 5 s | Candado: un comando a la vez por sala, aunque vengan de copias distintas |
| `room:{id}:conns` | HASH | Conexión → `{ user_id, name, instance }` |
| `rooms:public` | ZSET | Salas públicas, ordenadas por fecha |
| `rooms:instance:{id}` | string con TTL de 60 s | Marca de vida de cada copia del servicio |

- **Pub/sub.** Cada cambio se publica en el canal `rooms:events`. Todas las copias lo reciben
  y lo reenvían a sus propios WebSockets. Por eso un oyente conectado a la copia A ve lo que
  hizo el anfitrión conectado a la copia B. Esto está probado con dos copias corriendo a la vez.
- **Oyentes fantasma.** Cada copia renueva su marca de vida cada 20 s. Si una copia se cae,
  sus conexiones se descartan del conteo cuando vence su marca.
- **Vencimiento.** Una sala sin actividad se borra sola a las 24 h (`ROOM_TTL_SEC`).
- **Un usuario con dos pestañas** cuenta como un solo oyente.

Para correr dos copias (de este servicio y de audio_service):

```
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --build
```

Con dos copias no se publica el puerto local 8006, porque dos copias no pueden compartirlo.
nginx vuelve a consultar el DNS de Docker cada 10 s (`resolve` en el `upstream`), así que
no hace falta reiniciar el gateway. El header `X-Upstream` de `/api/v1/rooms` muestra qué
copia atendió cada pedido.

---

## Métricas

Cada oyente cuenta su reproducción como siempre (`POST /audio/played`) y le agrega el `room_id`
de la sala, que el contrato de `song.played.v1` ya tenía previsto.

## Variables de entorno

| Variable | Predeterminado | Para qué |
|---|---|---|
| `JWT_SECRET` | — | Verificar el JWT (el mismo de user_service) |
| `REDIS_URL` | `redis://redis:6379` | Estado y pub/sub |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672` | Publica `room.created.v1`, consume `song.deleted.v1` |
| `CATALOG_URL` | `http://catalog_service:8000` | Validar la canción en `set_song` |
| `ROOM_TTL_SEC` | `86400` | Borrar salas inactivas |
| `ROOM_DEFAULT_MAX_LISTENERS` | `50` | Máximo de oyentes si no se indica |
| `ROOM_START_DELAY_MS` | `1500` | Margen al cambiar de canción |
| `WS_AUTH_TIMEOUT_MS` | `5000` | Tiempo para mandar `auth` |
| `WS_HEARTBEAT_MS` | `25000` | Ping para detectar conexiones muertas |

## Tests

```
cd services/rooms_service
npm install
npm test     # 39 tests: posición, roles y permisos, cola y sugerencias, canción borrada, API REST (Redis y RabbitMQ simulados)
```
