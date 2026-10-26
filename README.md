# TeroMusic

## Infraestructura local (Integrante 4)

Requisitos: Git y Docker Desktop iniciado con contenedores Linux.
Ejecutar desde esta carpeta del repositorio clonado, en PowerShell:

```powershell
Copy-Item .env.example .env
 docker compose config --quiet
 docker compose up -d --wait
 docker compose ps
```

Copiar `.env.example` solamente la primera vez. `.env` no se sube a Git.
Las credenciales de ejemplo son para desarrollo local; cambiarlas para desplegar.

| Servicio | Acceso local | Host desde contenedores |
| --- | --- | --- |
| PostgreSQL | localhost:5433 | postgres:5432 |
| RabbitMQ | localhost:5672 | rabbitmq:5672 |
| RabbitMQ Dashboard | http://localhost:15672 | rabbitmq:15672 |
| MinIO S3 | http://localhost:9000 | minio:9000 |
| MinIO Console | http://localhost:9001 | minio:9001 |
| Redis | localhost:6379 | redis:6379 |

Las credenciales se configuran en `.env`. Los puertos se publican solamente
para la maquina local. Dentro de contenedores usar los hosts de la tabla,
ya que localhost apunta al propio contenedor.
Crear los buckets `raw-audio` y `processed-audio` desde MinIO Console antes
de integrar la carga y el procesamiento de audio.

El puerto local de PostgreSQL se configura con `POSTGRES_PORT` (5433 por
defecto, para evitar conflictos con una instalacion local en 5432).
Dentro de Docker PostgreSQL sigue escuchando en 5432.

MinIO se compila desde el codigo oficial de la version
`RELEASE.2025-10-15T17-29-55Z`, porque las imagenes publicadas en Docker Hub
y Quay no estuvieron disponibles. El primer inicio necesita descargar Go
y compilar las dependencias; los siguientes reutilizan la imagen local.
Para reconstruir: `docker compose build minio`.

Para consultar errores: `docker compose logs --tail 100`.
Para detener: `docker compose stop`. Para volver a iniciar:
`docker compose up -d --wait`.

`docker compose down` conserva los volumenes. Los cuatro servicios tienen
persistencia y Redis usa AOF. `docker compose down -v` borra los datos locales.
Los volumenes no reemplazan copias de seguridad.

PostgreSQL y RabbitMQ inicializan sus usuarios con volumenes nuevos; cambiar
.env despues no actualiza las credenciales ya guardadas. Para conservar los
datos, modificar los usuarios desde el servicio correspondiente.

Este Compose levanta la infraestructura compartida y metrics_service.
La API de metricas esta en http://localhost:8004/docs. Su contrato de eventos
y pruebas se documentan en services/metrics_service/README.md.
El siguiente bloque pendiente es notification_service
(historial y GET /notifications/user/{user_id}).
