"""Registro de eventos audio.uploaded.v1 ya procesados, compartido entre las copias del worker.

Regla 4 del contrato: RabbitMQ puede entregar dos veces el mismo evento y el consumidor
tiene que descartar los repetidos. Con varias copias del worker, una lista en memoria no
alcanza: el repetido puede caerle a otra copia. Por eso la lista vive en Redis.

- Se marca recién después de publicar el resultado: si una copia se cae a mitad de
  camino, el evento no queda marcado y RabbitMQ se lo da a otra.
- Si Redis no responde, se sigue con una lista en memoria de esta copia. Reprocesar una
  canción es seguro (se sobrescriben los mismos archivos), así que es preferible a frenar.
"""
import logging

from redis import asyncio as aioredis

from .config import settings

log = logging.getLogger("worker.processed")

KEY = "worker_ingesta:processed:{event_id}"


class ProcessedRegistry:
    def __init__(self, redis_url: str | None, ttl_sec: int):
        self._redis = aioredis.from_url(redis_url, socket_timeout=2) if redis_url else None
        self._ttl = ttl_sec
        self._local: set[str] = set()

    async def seen(self, event_id: str) -> bool:
        if event_id in self._local:
            return True
        if self._redis is None:
            return False
        try:
            return bool(await self._redis.exists(KEY.format(event_id=event_id)))
        except Exception as exc:
            log.warning("Redis no responde (%r); se usa solo la memoria de esta copia", exc)
            return False

    async def mark(self, event_id: str) -> None:
        self._local.add(event_id)
        if self._redis is None:
            return
        try:
            await self._redis.set(KEY.format(event_id=event_id), "1", ex=self._ttl)
        except Exception as exc:
            log.warning("No se pudo guardar %s en Redis (%r)", event_id, exc)


registry = ProcessedRegistry(settings.redis_url, settings.processed_ttl_sec)
