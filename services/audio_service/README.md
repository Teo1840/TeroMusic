# audio_service: streaming de audio con cache

Node.js 22 + Express. Sirve el audio procesado desde MinIO con Range
(HTTP 206), lo cachea en Redis por fragmentos (cache-aside) y publica
`song.played.v1` en RabbitMQ cuando el front avisa que la reproduccion
termino o se abandono.

## Inicio

Desde la raiz del repositorio:

```powershell
docker compose up -d --build --wait audio_service metrics_service
docker compose logs --tail 100 audio_service
```

API en http://localhost:8003 (`AUDIO_PORT` cambia el puerto local). Dentro
de Docker: `http://audio_service:8000`.

## GET /audio/stream-url/{song_id}

Pide login (`Authorization: Bearer <jwt>`). Devuelve una URL temporal firmada
para el stream, como las presigned URLs de S3:

```json
{ "url": "/api/v1/audio/stream/{song_id}?exp=1794410441&sig=J98h...", "expires_at": "2026-11-11T16:00:41Z" }
```

- Firma HMAC-SHA256 de `song_id` + `exp` con `JWT_SECRET` (o `STREAM_URL_SECRET`).
- Vence a los `STREAM_URL_TTL_SEC` (3600 s). `PUBLIC_STREAM_PATH` cambia la ruta devuelta.
- Errores: 401 sin login, 404 si no existe, 409 si no esta PUBLICADO.

## GET /audio/stream/{song_id}

```
GET /audio/stream/c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f?exp=1794410441&sig=J98h...&bitrate=128
Range: bytes=0-1048575
```

```
HTTP/1.1 206 Partial Content
Content-Type: audio/mpeg
Content-Range: bytes 0-1048575/3145728
Content-Length: 1048576
Accept-Ranges: bytes
X-Cache: MISS            (HIT si salio de Redis, PARTIAL si fue mixto)
```

- No pide header `Authorization` (`<audio src>` no puede mandarlo): exige la
  URL firmada de `/audio/stream-url`. 401 si falta la firma, 403 si es invalida,
  de otra cancion o vencio. Pedir audio no cuenta como reproduccion (ver `POST /audio/played`).
- Antes de servir consulta `GET {CATALOG_URL}/songs/{song_id}`:
  404 si no existe, 409 si el estado no es `PUBLICADO` (BORRADOR o FALLIDO).
  La respuesta PUBLICADO se cachea en Redis `CATALOG_CACHE_TTL_SEC` (60 s).
- `?bitrate=128` (predeterminado) o `320`: usa el `processed_key` de esa
  rendition del catalogo. Bucket `audio`, claves
  `processed/{song_id}/128.mp3` y `320.mp3` (las escribe worker_ingesta).
- Calculo del rango (`src/range.js`):
  - `bytes=a-b`: exactamente de a hasta b (tope de 8 MiB por respuesta).
  - `bytes=a-` o sin header: desde a hasta el final de su fragmento de 1 MiB.
  - `bytes=-n`: los ultimos n bytes.
  - Fuera del archivo: 416 con `Content-Range: bytes */<tamano>`.
- Errores: 400 (id o bitrate invalido), 404, 409, 503 (catalogo o MinIO caido).

## POST /audio/played

El front lo llama cuando la reproduccion **termina o se abandona** (evento
`ended`, cambio de cancion, cierre de pestana), como dice el contrato.

```
POST /audio/played
Authorization: Bearer <jwt>
Content-Type: application/json

{ "song_id": "c3d4...", "started_at": "2026-11-09T15:04:05Z",
  "listened_sec": 187.4, "completed": true, "bitrate_kbps": 128, "client": "web" }
```

- `user_id` sale del JWT (HS256 con `JWT_SECRET`, claim `JWT_USER_CLAIM`,
  `sub` por defecto). Si viene en el body, 400.
- Obligatorios: `song_id`, `started_at` (UTC terminado en `Z`), `listened_sec`.
  Opcionales: `completed`, `bitrate_kbps`, `client`, `room_id`. Se valida
  contra `contracts/events/song.played.v1.schema.json`; campos de mas, 400.
- La cancion tiene que estar PUBLICADO (404 / 409 si no).
- Responde `202 {"id": "<id del evento>"}` cuando RabbitMQ confirmo el mensaje.
  Errores: 400, 401 (sin token o token invalido), 404, 409, 503.
- Al cerrar la pestana usar `fetch(url, { method: 'POST', keepalive: true, headers, body })`:
  `navigator.sendBeacon` no puede mandar el header `Authorization`.

## Cache (cache-aside con Redis)

El archivo se divide en fragmentos de `CHUNK_SIZE` (1 MiB). Para cada
fragmento que toca el rango pedido:

1. Busca `audio:{clave en MinIO}:chunk:{num}` en Redis (128 y 320 no se mezclan).
2. Hit: lo usa directo.
3. Miss: lo lee de MinIO (`getPartialObject`), lo guarda en Redis con
   `EX CACHE_TTL_SEC` (3600 s) sin esperar, y lo entrega.

Luego recorta al rango exacto. Tambien cachea `audio:{clave}:meta` (tamano y
tipo) para no consultar MinIO en cada peticion. Si Redis se cae, el servicio
sigue sirviendo desde MinIO y `/health` responde `degraded`.

## Evento song.played.v1

- Exchange `musicapp.events` (topic, durable), routing key `song.played.v1`.
- Sobre CloudEvents de `contracts/`, mensaje persistente con confirmacion.
- `data`: lo que manda el front mas `user_id` del JWT. metrics_service lo cuenta.
- Hasta 3 reintentos con el mismo `id` (metrics descarta duplicados).

## Pruebas

```powershell
# En la maquina (sin Docker): rangos, JWT, evento contra contracts/ y endpoints
# con catalogo, MinIO y RabbitMQ simulados
cd services/audio_service; npm install; npm run test:unit

# Todo, dentro del contenedor (necesita metrics_service levantado)
docker compose exec -T audio_service npm test
```

La integracion sube 2.5 MiB de prueba a `audio/processed/{id}/128.mp3`, carga
la cancion como PUBLICADO en la cache del catalogo (no necesita una subida
real), verifica 206, MISS/HIT/PARTIAL, TTL en Redis, 416/404/400 y que metrics
cuente solo los 2 `POST /audio/played`. Borra el archivo y las claves al terminar.

## Pendiente con el equipo

- El servicio que emite el JWT tiene que usar el mismo `JWT_SECRET` y poner el
  UUID del usuario en `sub` (o cambiar `JWT_USER_CLAIM`).
