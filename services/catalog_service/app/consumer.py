"""Consumidor de audio.ready.v1 y audio.failed.v1 (cola catalog.q)."""
import asyncio
import json
import logging
import uuid

import aio_pika

from .config import settings
from .database import SessionLocal
from .models import ProcessedEvent, Song, SongStatus

log = logging.getLogger("catalog.consumer")

QUEUE = "catalog.q"
BINDINGS = ("audio.ready.v1", "audio.failed.v1")


def apply_event(song, event_type: str, data: dict) -> bool:
    """Aplica el resultado del worker a la canción. True si hubo cambios."""
    if event_type == "audio.ready.v1":
        renditions = data["renditions"]
        best = max(renditions, key=lambda r: r["bitrate_kbps"])
        song.status = SongStatus.PUBLICADO
        song.duration = data["duration_sec"]
        song.file_uri = f"{settings.minio_bucket}/{best['processed_key']}"
        song.renditions = renditions
        song.error_code = None
        song.error_message = None
        return True

    if event_type == "audio.failed.v1":
        if song.status == SongStatus.PUBLICADO:
            return False  # un fallo tardío no despublica una canción ya lista
        song.status = SongStatus.FALLIDO
        song.error_code = data["error_code"]
        song.error_message = data["error_message"]
        return True

    return False


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    try:
        event = json.loads(message.body)
        event_id = event["id"]
        event_type = event["type"]
        data = event["data"]
        song_id = uuid.UUID(data["song_id"])
        if event_type not in BINDINGS:
            raise KeyError(event_type)
    except (ValueError, KeyError, TypeError) as exc:
        log.error("Mensaje inválido, se descarta: %r", exc)
        await message.reject(requeue=False)
        return

    outcome = "ok"
    try:
        async with SessionLocal() as session:
            if await session.get(ProcessedEvent, event_id) is not None:
                outcome = "duplicado"
            else:
                song = await session.get(Song, song_id)
                if song is None:
                    outcome = "sin_cancion"
                else:
                    try:
                        apply_event(song, event_type, data)
                    except (KeyError, TypeError, ValueError) as exc:
                        log.error("Datos inválidos en %s: %r", event_type, exc)
                        outcome = "invalido"
                    else:
                        session.add(ProcessedEvent(id=event_id))
                        await session.commit()
    except Exception:
        log.exception("Error de base de datos; el mensaje vuelve a la cola")
        await asyncio.sleep(5)
        await message.nack(requeue=True)
        return

    if outcome in ("sin_cancion", "invalido"):
        log.warning("Evento %s descartado (%s) para %s", event_type, outcome, song_id)
        await message.reject(requeue=False)
        return
    if outcome == "duplicado":
        log.info("Evento %s ya procesado, se ignora", event_id)
    else:
        log.info("Canción %s actualizada por %s", song_id, event_type)
    await message.ack()


async def _run(queue: aio_pika.abc.AbstractQueue) -> None:
    async with queue.iterator() as it:
        async for message in it:
            await handle(message)


async def start():
    """Conecta, declara catalog.q y arranca el consumo en segundo plano."""
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=10)
    exchange = await channel.declare_exchange(
        settings.events_exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )
    queue = await channel.declare_queue(
        QUEUE, durable=True, arguments={"x-dead-letter-exchange": "musicapp.dlx"}
    )
    for routing_key in BINDINGS:
        await queue.bind(exchange, routing_key=routing_key)
    task = asyncio.create_task(_run(queue))
    log.info("Consumidor listo en %s (%s)", QUEUE, ", ".join(BINDINGS))
    return connection, task
