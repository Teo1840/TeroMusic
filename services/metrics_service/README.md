# Servicio de metricas

Cuenta reproducciones de canciones a partir de eventos de RabbitMQ.
FastAPI + asyncpg + aio-pika. No necesita MinIO ni Redis.

## Inicio

Desde la raiz del repositorio, con `.env` configurado:

```powershell
docker compose up -d --build --wait metrics_service
docker compose logs --tail 100 metrics_service
```

API: http://localhost:8004. Swagger: http://localhost:8004/docs.
`METRICS_PORT` cambia el puerto local; dentro de Docker se usa
`http://metrics_service:8000`.

## Consulta

`GET /metrics/songs/{song_id}`

```json
{"song_id":"song-123","total_plays":12}
```

Sin reproducciones conocidas devuelve 200 y `total_plays: 0`. Este servicio no
consulta el catalogo: ese cero no confirma que la cancion exista.
`GET /health` devuelve 200 si PostgreSQL y RabbitMQ estan disponibles, o 503
si falla alguna dependencia. Las consultas devuelven 503 si falla PostgreSQL.
No hay autenticacion implementada todavia; la integracion con JWT y el gateway
debe coordinarse con el responsable de esos componentes.

## Contrato para el servicio de streaming

Publicar al empezar una reproduccion, no por cada fragmento:

- Exchange `domain_events`, tipo `topic`, durable.
- Routing key `song.played`.
- Cuerpo JSON UTF-8, content type `application/json` y mensaje persistente.
- Cola del consumidor: `metrics.song.played`, durable.

```json
{
  "event_id": "49b9e58c-c16d-4eb6-aa68-5c18d812020b",
  "song_id": "song-123",
  "user_id": "user-456",
  "timestamp": "2026-10-26T14:00:00Z"
}
```

IDs: cadenas no vacias, sin espacios, de hasta 128 caracteres. Timestamp:
fecha ISO 8601 con zona horaria. Se permiten campos adicionales.
`event_id` es opcional para aceptar el contrato original, pero se recomienda
que el productor genere uno por reproduccion y lo conserve al reintentar.
Si falta, se usa el `message_id` AMQP; si tampoco existe, se genera un UUID
y cada entrega cuenta como una reproduccion nueva. No se puede garantizar
deduplicacion si el productor omite ambos identificadores.

La confirmacion AMQP se envia despues del commit de PostgreSQL. El evento
y el incremento atomico se guardan en una misma transaccion. El ID del evento
es unico globalmente: retransmitirlo no incrementa de nuevo el contador.
La lectura tiene consistencia eventual: un mensaje pendiente aun no aparece.
Iniciar el servicio una vez antes de publicar para que exista la cola y su binding.
Un productor debe usar confirmaciones del broker para verificar sus envios.

## Persistencia y errores

Las tablas `analytics.play_events` y `analytics.song_metrics` se crean al
iniciar dentro de `POSTGRES_DB`, en un esquema separado de otros servicios.
Representan ANALYTICS DB de forma logica sobre el PostgreSQL compartido.
No se cambian tablas del catalogo ni de usuarios. Para una separacion fisica
posterior se puede apuntar POSTGRES_DB del servicio a una base dedicada.

Una caida de PostgreSQL revierte la transaccion y reencola el mensaje despues
de una pausa. La conexion robusta a RabbitMQ recupera la suscripcion al reconectar.
Compose reinicia el proceso si falla durante el arranque.
Los eventos invalidos pasan a `metrics.song.played.invalid` para inspeccion
en RabbitMQ Management. No se descartan silenciosamente ni se cuentan.

## Prueba de integracion

Con los servicios levantados:

```powershell
docker compose exec -T metrics_service python -m tests.integration
```

Publica mensajes reales y consulta la API. Verifica cero inicial, persistencia,
reproducciones concurrentes, duplicados, compatibilidad sin event_id y mensajes
invalidos. Usa una cancion de prueba unica y elimina sus datos al finalizar.
