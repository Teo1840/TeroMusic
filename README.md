# TeroMusic

## Infraestructura local

Requisitos: Docker Desktop con contenedores Linux. Desde la raiz del repositorio:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up -d --build --wait
```

Copiar el ejemplo solo la primera vez. Si ya existe `.env`, conservarlo:
las credenciales inicializadas en PostgreSQL y RabbitMQ no cambian por editar
variables. `.env` es local y no se sube a Git.

Los valores por defecto coinciden con main:

| Servicio | Acceso local | Host dentro de Docker | Usuario de ejemplo |
| --- | --- | --- | --- |
| PostgreSQL | localhost:5432 | postgres:5432 | admin |
| RabbitMQ AMQP | localhost:5672 | rabbitmq:5672 | guest |
| RabbitMQ Dashboard | http://localhost:15672 | rabbitmq:15672 | guest |
| MinIO API | http://localhost:9000 | minio:9000 | minioadmin |
| MinIO Console | http://localhost:9001 | minio:9001 | minioadmin |
| Redis | localhost:6379 | redis:6379 | - |
| Metricas | http://localhost:8004/docs | metrics_service:8000 | - |

Contrasenas de ejemplo en `.env.example`. Son valores de desarrollo local.
Se permite guest entre contenedores para mantener compatibilidad con main;
los puertos publicados se limitan a la maquina local. No usar este Compose
con estas credenciales como despliegue publico.

Si Windows bloquea el puerto 5432, poner `POSTGRES_PORT=5433` en el `.env`
local. Dentro de Docker PostgreSQL siempre usa 5432. Los entornos inicializados
con la version anterior pueden conservar sus usuarios `tero` y `tero_minio`
en `.env`, sin cambiar los valores compartidos ni borrar sus volumenes.

MinIO usa la misma imagen que main:
`docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z`.
Los buckets se crean solos al levantar el Compose: el servicio `minio-init`
crea `audio` (el del contrato, para catalogo y worker), `raw-audio` y
`processed-audio`, y termina. Si ya existen, no los toca.

Hay healthchecks y volumenes persistentes para los cuatro servicios base.
`docker compose stop` detiene; `docker compose up -d --wait` inicia.
`docker compose logs --tail 100` muestra errores.
`docker compose down` conserva volumenes; `docker compose down -v` borra datos.
No borrar volumenes para resolver diferencias de credenciales.

## Servicios

Con el Compose levantado, la app queda en http://localhost:5173. Cada servicio
tiene su README con mas detalle.

| Servicio | Que hace | Acceso local | README |
| --- | --- | --- | --- |
| frontend | Aplicacion web (React) | http://localhost:5173 | [frontend](frontend/README.md) |
| gateway | Entrada unica: login, rutas y limites | http://localhost:8080 | [gateway](gateway/README.md) |
| user_service | Registro, login y JWT | http://localhost:8011/docs | [user_service](services/user_service/README.md) |
| catalog_service | Subida (.wav/.mp3) y listado de canciones | http://localhost:8000/docs | [catalog_service](services/catalog_service/README.md) |
| worker_ingesta | Convierte a MP3 128/320 kbps y genera la forma de onda | - | [worker_ingesta](services/worker_ingesta/README.md) |
| audio_service | Streaming de audio | http://localhost:8003 | [audio_service](services/audio_service/README.md) |
| metrics_service | Metricas de reproducciones | http://localhost:8004/docs | [metrics_service](services/metrics_service/README.md) |
| notification_service | Notificaciones | http://localhost:8005/docs | [notification_service](services/notification_service/README.md) |
| rooms_service | Salas en vivo | http://localhost:8006 | [rooms_service](services/rooms_service/README.md) |

## Eventos y metricas

Los contratos del equipo estan en `contracts/README.md`.
Metricas consume `song.played.v1` de `musicapp.events` mediante `metrics.q`.
Valida el sobre CloudEvents y el data con los JSON Schema del repositorio;
usa `id` para deduplicar. Ver `services/metrics_service/README.md`.
Notificaciones: `notification_service` en http://localhost:8005/docs.
Historial: `GET /notifications/user/{user_id}`. Ver `services/notification_service/README.md`.

Streaming: audio_service (Node.js) en http://localhost:8003. Sirve
`GET /audio/stream/{song_id}` (URL firmada que vence) con cache Redis por fragmentos
y publica `song.played.v1` con `POST /audio/played`. Ver `services/audio_service/README.md`.

Salas en vivo: rooms_service (Node.js + WebSockets) en http://localhost:8006.
Reproduccion sincronizada con anfitrion y coanfitriones, estado en Redis y
`room.created.v1`. Ver `services/rooms_service/README.md`.
