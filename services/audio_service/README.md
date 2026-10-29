# Servicio de streaming de audio

Sirve el audio guardado en MinIO con soporte de `Range` (para adelantar y
retroceder) y publica `song.played` en RabbitMQ para metrics_service.
FastAPI + SDK de MinIO + aio-pika. No usa PostgreSQL ni Redis.

## Inicio

Desde la raiz del repositorio, con `.env` configurado:

```powershell
docker compose up -d --build --wait audio_service metrics_service
docker compose logs --tail 100 audio_service
```

API: http://localhost:8003. Swagger: http://localhost:8003/docs.
`AUDIO_PORT` cambia el puerto local; dentro de Docker se usa
`http://audio_service:8000`.

## Endpoints

`GET /stream/{song_id}?user_id=<id>` (o header `X-User-Id: <id>`)

- Busca `processed-audio/{song_id}.*`. Si no existe, usa el original
  `raw-audio/{song_id}.*` que sube catalog_service. Asi funciona antes de que
  exista el worker de ingesta.
- Sin `Range` responde 200 con el archivo entero. Con `Range: bytes=a-b`
  responde 206 con `Content-Range`. Un rango fuera del archivo devuelve 416.
- 404 si la cancion no esta en ninguno de los dos buckets. 400 si falta el usuario.
- `song_id`: letras, numeros, `-` y `_`, hasta 128 caracteres (los UUID del catalogo).

Se acepta `?user_id=` porque `<audio src="...">` no puede enviar headers.
Es temporal: cuando exista el gateway, el usuario saldra del JWT.

`GET /health` devuelve 200 si MinIO y RabbitMQ responden, 503 si no.

## Evento publicado

Sigue el contrato de `services/metrics_service/README.md`:

- Exchange `domain_events` (topic, durable), routing key `song.played`.
- JSON UTF-8, `application/json`, mensaje persistente, con confirmacion del broker.
- `message_id` AMQP igual a `event_id`.

```json
{
  "event_id": "49b9e58c-c16d-4eb6-aa68-5c18d812020b",
  "song_id": "c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  "user_id": "user-456",
  "timestamp": "2026-10-26T14:00:00Z"
}
```

Cuando se publica: una vez por reproduccion, en la peticion que empieza en el
byte 0 (sin `Range` o `bytes=0-...`). Los rangos intermedios (adelantar) no
cuentan. Tampoco el sondeo `bytes=0-1` que hace Safari antes de reproducir.

La publicacion corre en segundo plano para no retrasar el audio. Si falla, se
reintenta 3 veces con el mismo `event_id` (metrics descarta duplicados) y
despues se registra en el log; el audio se sirve igual.

## Prueba de integracion

Con audio_service y metrics_service levantados:

```powershell
docker compose exec -T audio_service python -m tests.integration
```

Sube un WAV de prueba a `raw-audio` (crea el bucket si no existe), prueba
200, 206, 404 y 416, y comprueba en metrics que se conto exactamente una
reproduccion. Borra el WAV al terminar; el contador de prueba queda en metrics
con un `song_id` que empieza por `integration-audio-`.

## Pendiente

- Autenticacion con JWT a traves del gateway.
- `contracts/` (en main) describe otro formato (`musicapp.events`, CloudEvents).
  Hay que acordar en el equipo cual queda y actualizar el que no.
