#!/bin/bash
# Arranca el worker en Docker, conectado a RabbitMQ y MinIO del Mac
# (los puertos que publica docker compose). Uso:  bash run_worker.sh
# Para otras credenciales:  RABBITMQ_URL=... MINIO_ACCESS_KEY=... bash run_worker.sh
cd "$(dirname "$0")"
docker build -q -t worker-ingesta . > /dev/null || exit 1
docker run --rm --name worker_ingesta \
  -e RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@host.docker.internal:5672/}" \
  -e MINIO_ENDPOINT="${MINIO_ENDPOINT:-host.docker.internal:9000}" \
  -e MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}" \
  -e MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadminpassword}" \
  worker-ingesta
