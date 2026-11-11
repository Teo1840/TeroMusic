# Contratos de eventos

Todos los eventos que viajan por RabbitMQ usan el mismo sobre ([CloudEvents 1.0](https://cloudevents.io), formato JSON) y un `data` propio de cada tipo.

```
contracts/
  envelope.schema.json        ← valida el sobre
  events/<type>.schema.json   ← valida el "data" de cada evento
  examples/<type>.example.json
  validate.py                 ← valida ejemplos o eventos sueltos
```

## Catálogo

| type | Publica | Consume | Cuándo |
|---|---|---|---|
| `user.registered.v1` | user_service | notification_service, metrics_service | El usuario terminó el registro |
| `audio.uploaded.v1` | catalog_service | worker_ingesta | El original quedó en MinIO (`raw/…`) |
| `audio.ready.v1` | worker_ingesta | catalog_service | Las versiones procesadas quedaron en MinIO (`processed/…`) |
| `audio.failed.v1` | worker_ingesta | catalog_service | La transcodificación falló tras los reintentos |
| `song.played.v1` | audio_service | metrics_service | Terminó o se abandonó una reproducción (una vez, no por chunk) |
| `room.created.v1` | rooms_service | metrics_service, notification_service | Se creó una sala en vivo |

## Topología RabbitMQ

- Exchange: `musicapp.events` (tipo `topic`, durable).
- Routing key = `type` del evento (`audio.uploaded.v1`).
- Una cola durable por consumidor:

| Cola | Bindings |
|---|---|
| `worker_ingesta.q` | `audio.uploaded.v1` |
| `catalog.q` | `audio.ready.v1`, `audio.failed.v1` |
| `metrics.q` | `song.played.v1`, `user.registered.v1`, `room.created.v1` |
| `notifications.q` | `user.registered.v1`, `room.created.v1`, `audio.uploaded.v1`, `audio.ready.v1`, `audio.failed.v1` |

- Dead-letter: exchange `musicapp.dlx` → cola `musicapp.dlq`. Cada cola declara `x-dead-letter-exchange: musicapp.dlx`.

## Reglas

1. **Nombres:** `<entidad>.<accion_en_pasado>.v<N>`, en minúsculas. El nombre del archivo es igual al `type`.
2. **IDs:** siempre UUID como string. Fechas en RFC 3339, en UTC (terminan en `Z`).
3. **Nada de binarios en eventos:** el audio vive en MinIO y el evento lleva la ruta.
4. **Idempotencia:** RabbitMQ puede entregar dos veces. El consumidor guarda los `id` procesados y descarta los repetidos.
5. **`correlationid`:** se genera en el gateway y se propaga a todos los eventos que nacen de esa petición.
6. **Cambios:**
   - Agregar un campo **opcional** → misma versión.
   - Quitar, renombrar o hacer obligatorio un campo → nueva versión (`.v2`). El productor publica ambas hasta que todos los consumidores migren.
   - Los schemas de `data` usan `additionalProperties: false`: un campo nuevo debe agregarse al schema antes de publicarse.

## Validar

```bash
pip install "jsonschema[format]"
python contracts/validate.py               # todos los ejemplos
python contracts/validate.py evento.json   # un archivo concreto
```

Notificaciones tambien consume eventos de audio: guarda el propietario de
`audio.uploaded.v1` y notifica con `audio.ready.v1` o `audio.failed.v1`.
