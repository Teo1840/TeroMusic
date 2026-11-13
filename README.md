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
| user_service | Registro, login, JWT y perfil (nombre de artista) | http://localhost:8011/docs | [user_service](services/user_service/README.md) |
| catalog_service | Subida (.wav/.mp3), listado de canciones con su artista y playlists | http://localhost:8000/docs | [catalog_service](services/catalog_service/README.md) |
| worker_ingesta | Convierte a MP3 128/320 kbps y genera la forma de onda. Worker Pool de 3 copias (`WORKER_REPLICAS`) | - | [worker_ingesta](services/worker_ingesta/README.md) |
| audio_service | Streaming de audio | http://localhost:8003 | [audio_service](services/audio_service/README.md) |
| metrics_service | Metricas de reproducciones | http://localhost:8004/docs | [metrics_service](services/metrics_service/README.md) |
| notification_service | Notificaciones | http://localhost:8005/docs | [notification_service](services/notification_service/README.md) |
| rooms_service | Salas en vivo | http://localhost:8006 | [rooms_service](services/rooms_service/README.md) |

## Roles

Hay dos roles de plataforma: `user` (todos al registrarse) y `admin`. El primer admin se
define con `ADMIN_EMAILS` en `.env`; después se administran desde la página `/admin` del front.
Un admin ve todas las cuentas y cambia roles, borra canciones de cualquiera y cierra cualquier
sala. Ver [user_service](services/user_service/README.md#roles-y-administración).

## Eventos y metricas

Los contratos del equipo estan en `contracts/README.md`.
Metricas consume `song.played.v1` de `musicapp.events` mediante `metrics.q`.
Valida el sobre CloudEvents y el data con los JSON Schema del repositorio;
usa `id` para deduplicar. Ver `services/metrics_service/README.md`.
Artistas: `user_service` publica `user.registered.v1` y `user.profile_updated.v1`; catalogo
guarda una copia del nombre de cada artista (tabla `artists`). Ver `services/catalog_service/README.md`.
Notificaciones: `notification_service` en http://localhost:8005/docs.
Historial: `GET /notifications/user/{user_id}`. Ver `services/notification_service/README.md`.

Streaming: audio_service (Node.js) en http://localhost:8003. Sirve
`GET /audio/stream/{song_id}` (URL firmada que vence) con cache Redis por fragmentos
y publica `song.played.v1` con `POST /audio/played`. Ver `services/audio_service/README.md`.

Salas en vivo: rooms_service (Node.js + WebSockets) en http://localhost:8006.
Reproduccion sincronizada con anfitrion y coanfitriones, estado en Redis y
`room.created.v1`. Ver `services/rooms_service/README.md`.

## Seguridad

Revisión de noviembre de 2026. Lo corregido está explicado en el README de cada servicio.

| Problema | Riesgo | Arreglo | Dónde |
| --- | --- | --- | --- |
| Un archivo subido podía hacer que FFmpeg pidiera URLs internas (playlist HLS con extensión `.mp3`) | Alto | Formato forzado por extensión y solo protocolo `file` | [worker_ingesta](services/worker_ingesta/README.md#seguridad-formato-de-entrada) |
| El límite de login por IP se salteaba con un `X-Forwarded-For` inventado | Medio | El proxy del front reemplaza el header y el gateway toma solo la última IP | [gateway](gateway/README.md#límites-de-pedidos-por-ip) |
| Contraseñas sin largo mínimo | Medio | Entre 8 caracteres y 72 bytes al registrarse | [user_service](services/user_service/README.md#contraseñas-y-login) |
| El tiempo de respuesta de `/login` revelaba si un email existía | Bajo | Se compara siempre contra un hash | [user_service](services/user_service/README.md#contraseñas-y-login) |
| Si RabbitMQ fallaba al subir, la canción quedaba en BORRADOR para siempre (y el 503 mostraba el error interno) | Bug | Se deshace la subida; el detalle va al log | [catalog_service](services/catalog_service/README.md#subir-una-canción) |
| Un título de más de 200 caracteres daba `500` y dejaba el archivo en MinIO | Bug | Se valida el título antes de subir | [catalog_service](services/catalog_service/README.md#subir-una-canción) |
| Dos registros simultáneos con el mismo email daban `500` | Bug | Responde `409` | [user_service](services/user_service/README.md#contraseñas-y-login) |
| CORS aceptaba cualquier `Origin` con `Allow-Credentials` | Bajo | Solo el front local, sin credenciales | [gateway](gateway/README.md#cors) |
| `/api/v1/auth/docs` y `/openapi.json` se veían por el gateway | Bajo | `404` en el gateway (siguen en `localhost:8011/docs`) | [gateway](gateway/README.md#rutas) |
| `GET /songs` y `GET /songs/{id}` mostraban `file_uri` y renditions, y borradores ajenos con su error | Bajo | Sin rutas internas por el gateway; lo no publicado, solo para dueño y admins | [catalog_service](services/catalog_service/README.md#quién-ve-qué) |
| Las reproducciones se podían inflar repitiendo `POST /audio/played` | Medio | Tiempos coherentes, mínimo 30 s y sin superponer reproducciones del mismo usuario | [audio_service](services/audio_service/README.md#que-no-se-pueda-inflar-el-contador-srcplaysjs) |
| Varios entrando a la vez pasaban el tope de oyentes de una sala | Bug | Contar y anotarse con el candado de la sala | [rooms_service](services/rooms_service/README.md#roles) |
| Sin `.env` el Compose arrancaba con `JWT_SECRET` vacío y catálogo sin credenciales | Bug | `JWT_SECRET` obligatorio con mensaje claro; el resto con valores por defecto | [docker-compose.yml](docker-compose.yml) |

Pendiente:

- **`JWT_SECRET`:** usar 32 caracteres aleatorios o más (`openssl rand -hex 32`). Con el valor
  de `.env.example` cualquiera puede firmar tokens válidos. El Compose ya no arranca sin él.
- **Servicios internos que confían en el gateway:** catalog_service y rooms_service leen
  `X-User-Id` / `X-User-Role` sin verificar el token. Es seguro porque sus puertos solo se
  publican en `127.0.0.1`; en un despliegue real no deben quedar accesibles por fuera del gateway.
