# Servicio de metricas

FastAPI, PostgreSQL y RabbitMQ. Desde la raiz del repositorio:

```powershell
docker compose up -d --build --wait metrics_service
docker compose exec -T metrics_service python contracts/validate.py
docker compose exec -T metrics_service python -m tests.integration
```

Swagger: http://localhost:8004/docs. Puerto configurable con METRICS_PORT.
Dentro de Docker: http://metrics_service:8000.

## API

GET /metrics/songs/{song_id} devuelve:

```json
{"song_id":"c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f","total_plays":12}
```

Devuelve cero si no hay reproducciones registradas; no verifica la existencia
en catalogo. GET /health verifica PostgreSQL y RabbitMQ. Las dependencias no
disponibles producen 503. Autenticacion JWT y ruteo del gateway aun pendientes.

## Contrato compartido

La fuente es contracts/README.md y los schemas de contracts/.

- Exchange topic durable: musicapp.events.
- Routing key y type: song.played.v1.
- Cola durable: metrics.q, binding song.played.v1.
- Errores: musicapp.dlx (topic) -> musicapp.dlq (binding #).
- Publicar mensajes persistentes y usar confirmaciones AMQP.
- El productor emite una vez al terminar o abandonar la reproduccion, no por chunk.

Ejemplo completo: contracts/examples/song.played.v1.example.json.
El sobre lleva specversion, id (UUID estable), source, type, time,
datacontenttype y data. El data requiere song_id y user_id UUID,
started_at en UTC terminado en Z, y listened_sec >= 0.
Los campos adicionales permitidos estan en el schema del equipo.

Se validan sobre y data con jsonschema y FormatChecker. Se exige que routing key
coincida con type. El contador suma cada evento valido una vez, incluso si
listened_sec es cero; no se acordo un umbral minimo de escucha.
El id del sobre evita duplicados. played_at guarda data.started_at.
El conteo y el evento se guardan atomicamente antes del ack de RabbitMQ.
La consistencia es eventual: puede haber mensajes pendientes aun sin contar.

Este servicio implementa metricas de canciones. No se suscribe a
user.registered.v1 ni room.created.v1: sus metricas no forman parte de esta
entrega de audio bajo demanda. Los contratos comunes se conservan completos.

## Persistencia y transicion

Usa analytics.play_events y analytics.song_metrics dentro de POSTGRES_DB.
El esquema se crea al iniciar; las tablas de otros servicios no se alteran.
Si PostgreSQL falla, reencola tras una pausa; RabbitMQ se reconecta con
connect_robust. Los mensajes invalidos pasan a la DLQ compartida.

Se reemplazo el contrato provisional domain_events/song.played por el contrato
de main. El formato plano anterior ya no se consume: actualizar productores.
Los contadores existentes se conservan. No se borran las colas antiguas
metrics.song.played ni metrics.song.played.invalid; si tienen mensajes
pendientes, inspeccionarlos y migrarlos antes de retirarlas.

La prueba publica eventos basados en el ejemplo del equipo y verifica consulta
inicial, concurrencia, deduplicacion por id, persistencia y rechazo de invalidos.
Usa un UUID de cancion de prueba y elimina solamente sus datos al terminar.
La conexion real con el servicio de audio requiere que su productor adopte
este mismo contrato; no se modifica la rama de otro integrante automaticamente.
