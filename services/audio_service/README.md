# audio_service: streaming de audio con cache

Node.js 22 + Express. Sirve el audio procesado desde MinIO por fragmentos
(HTTP 206), los cachea en Redis (cache-aside) y publica `song.played.v1` en
RabbitMQ al iniciar cada reproduccion.

## Inicio

Desde la raiz del repositorio:

```powershell
docker compose up -d --build --wait audio_service metrics_service
docker compose logs --tail 100 audio_service
```

API en http://localhost:8003 (`AUDIO_PORT` cambia el puerto local). Dentro
de Docker: `http://audio_service:8000`.

## GET /audio/stream/{song_id}

```
GET /audio/stream/c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f?user_id=<uuid>
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

- `song_id` y el usuario deben ser UUID (lo exige el contrato). El usuario va
  en el header `X-User-Id` o en `?user_id=`; `<audio src>` no puede mandar
  headers. Cuando exista el gateway saldra del JWT.
- Archivo leido: bucket `processed-audio`, clave `{song_id}/128.mp3`
  (`PROCESSED_BUCKET` y `AUDIO_KEY_TEMPLATE`).
- Calculo del rango (`src/range.js`):
  - `bytes=a-b`: exactamente de a hasta b (tope de 8 MiB por respuesta).
  - `bytes=a-` o sin header: desde a hasta el final de su fragmento de 1 MiB.
  - `bytes=-n`: los ultimos n bytes.
  - Fuera del archivo: 416 con `Content-Range: bytes */<tamano>`.
- Errores: 400 (ids invalidos), 404 (no existe), 503 (MinIO caido).

## Cache (cache-aside con Redis)

El archivo se divide en fragmentos de `CHUNK_SIZE` (1 MiB). Para cada
fragmento que toca el rango pedido:

1. Busca `song:{id}:chunk:{num}` en Redis.
2. Hit: lo usa directo.
3. Miss: lo lee de MinIO (`getPartialObject`), lo guarda en Redis con
   `EX CACHE_TTL_SEC` (3600 s) sin esperar, y lo entrega.

Luego recorta al rango exacto. Tambien cachea `song:{id}:meta` (tamano y
tipo) para no consultar MinIO en cada peticion. Si Redis se cae, el servicio
sigue sirviendo desde MinIO y `/health` responde `degraded`.

## Evento song.played.v1

Fire-and-forget: se agenda con `setImmediate` y la respuesta no lo espera.
Se publica cuando la peticion empieza en el byte 0 (inicio de reproduccion).
Adelantar no cuenta, ni la sonda `bytes=0-1` de Safari.

- Exchange `musicapp.events` (topic, durable), routing key `song.played.v1`.
- Sobre CloudEvents de `contracts/`, mensaje persistente con confirmacion.
- `data`: `song_id`, `user_id`, `started_at` (momento de inicio) y
  `listened_sec: 0` (todavia no se escucho nada). metrics_service lo cuenta.
- Hasta 3 reintentos con el mismo `id` (metrics descarta duplicados).

## Pruebas

```powershell
# En la maquina (sin Docker): rangos y validacion del evento contra contracts/
cd services/audio_service; npm install; npm run test:unit

# Todo, dentro del contenedor (necesita metrics_service levantado)
docker compose exec -T audio_service npm test
```

La integracion sube 2.5 MiB de prueba a `processed-audio`, verifica 206,
MISS/HIT/PARTIAL, TTL en Redis, 416/404/400 y que metrics cuente 2
reproducciones. Borra el archivo y las claves al terminar.

## Pendiente con el equipo

- worker_ingesta guarda en el bucket `audio` con prefijo `processed/`. Este
  servicio lee `processed-audio` como pide la consigna. Para alinear basta
  con cambiar `PROCESSED_BUCKET` / `AUDIO_KEY_TEMPLATE` o el worker.
- El contrato dice que song.played se publica al terminar con los segundos
  escuchados; aca se publica al iniciar con `listened_sec: 0`, como pide la
  consigna del Integrante 3.
- Autenticacion JWT via gateway.
