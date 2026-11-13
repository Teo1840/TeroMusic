# Servicio de metricas

FastAPI, PostgreSQL y RabbitMQ. Desde la raiz del repositorio:

```powershell
docker compose up -d --build --wait metrics_service
docker compose exec -T metrics_service python contracts/validate.py
docker compose exec -T metrics_service python -m tests.integration
```

Tests unitarios (sin Postgres ni RabbitMQ; el pool y los mensajes se simulan en
tests/test_batch.py y tests/test_handle.py):

```
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest --ignore=tests/integration.py
```

Swagger: http://localhost:8004/docs. Puerto configurable con METRICS_PORT.
Dentro de Docker: http://metrics_service:8000.

## API

GET /metrics/songs/{song_id} devuelve:

```json
{"song_id":"c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f","total_plays":12}
```

Devuelve cero si no hay reproducciones registradas; no verifica la existencia
en catalogo.

POST /metrics/songs/batch devuelve las reproducciones de varias canciones en un
solo pedido (el perfil lo usa para todas las canciones de un artista). Body:

```json
{"song_ids":["c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f","otra"]}
```

Responde una entrada por id, en el mismo orden y sin repetidos; las que no tienen
reproducciones vienen con 0. Entre 1 y 500 ids por pedido (fuera de rango, 422).

```json
{"songs":[{"song_id":"c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f","total_plays":12},{"song_id":"otra","total_plays":0}]}
```

GET /metrics/plays devuelve el total de reproducciones de todas las canciones:

```json
{"plays":154}
```

GET /metrics/summary devuelve los totales globales: reproducciones, usuarios
registrados y salas creadas (cada usuario o sala cuenta una vez):

```json
{"plays":42,"users":7,"rooms":3}
```

Usuarios y salas se cuentan desde que el servicio escucha esos eventos: los
registros anteriores no estan en su base.

GET /metrics/top?limit=10 devuelve las canciones mas reproducidas, de mayor a
menor. limit va de 1 a 100 (por defecto 10); fuera de rango responde 422.
Solo incluye canciones con al menos una reproduccion; los titulos se buscan
en catalogo.

```json
{"songs":[{"song_id":"c3d4e5f6-1a2b-4c3d-8e9f-0a1b2c3d4e5f","total_plays":12}]}
```
 GET /health verifica PostgreSQL y RabbitMQ. Las dependencias no
disponibles producen 503. Por el gateway: /api/v1/metrics/... con JWT.

## Contrato compartido

La fuente es contracts/README.md y los schemas de contracts/.

- Exchange topic durable: musicapp.events.
- Routing keys y types: song.played.v1, song.deleted.v1, user.registered.v1 y room.created.v1.
- Cola durable: metrics.q, con un binding por cada uno.
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

user.registered.v1 y room.created.v1 se guardan en analytics.domain_events
(un registro por evento, con su fecha; el id del sobre evita duplicados) y se
cuentan en /metrics/summary.

song.deleted.v1 borra el contador de esa cancion (sale del top y de
/metrics/songs/{id}). Sus reproducciones quedan en analytics.play_events: el
total global (/metrics/plays y summary.plays) sale de ese historial y no baja.

## Persistencia y transicion

Usa analytics.play_events y analytics.song_metrics dentro de POSTGRES_DB.
El esquema se crea al iniciar; las tablas de otros servicios no se alteran.
Errores al guardar:
- Pasajeros (PostgreSQL caido, conexion cortada, sin conexiones libres, deadlock):
  el mensaje vuelve a la cola tras una pausa y se reintenta hasta que la base vuelva.
- Cualquier otro (el mensaje no se puede guardar nunca): va a la DLQ compartida
  en vez de reintentarse para siempre.
Los mensajes invalidos tambien pasan a la DLQ. RabbitMQ se reconecta con
connect_robust.

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
