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
Crear los buckets `raw-audio` y `processed-audio` en cada entorno local.
Los buckets creados en otra maquina no se distribuyen al clonar el repo.

Hay healthchecks y volumenes persistentes para los cuatro servicios base.
`docker compose stop` detiene; `docker compose up -d --wait` inicia.
`docker compose logs --tail 100` muestra errores.
`docker compose down` conserva volumenes; `docker compose down -v` borra datos.
No borrar volumenes para resolver diferencias de credenciales.

## Eventos y metricas

Los contratos del equipo estan en `contracts/README.md`.
Metricas consume `song.played.v1` de `musicapp.events` mediante `metrics.q`.
Valida el sobre CloudEvents y el data con los JSON Schema del repositorio;
usa `id` para deduplicar. Ver `services/metrics_service/README.md`.
Notificaciones sigue pendiente.
