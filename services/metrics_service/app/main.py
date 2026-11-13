import asyncio
import logging
import os
from contextlib import AsyncExitStack, asynccontextmanager

import aio_pika
from fastapi import FastAPI, HTTPException, Path, Query
from pydantic import ValidationError
from jsonschema.exceptions import ValidationError as SchemaValidationError

from app.database import SCHEMA, forget_song, is_transient, open_pool, record_event, record_play
from app.models import SongDeleted, SongMetrics, SongPlayed, SongsBatch, Summary, TopSongs, TotalPlays
from app.events import TYPES, parse_event


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("metrics")

RETRY_DELAY_SEC = 2


async def handle(message, pool):
    """Procesa un mensaje de metrics.q y lo confirma, reintenta o descarta.

    - Inválido (no cumple el contrato): a la cola de errores, sin reintentar.
    - Error pasajero de la base: vuelve a la cola después de una pausa.
    - Cualquier otro error: a la cola de errores. Reintentar un mensaje que falla
      siempre lo dejaría dando vueltas para siempre y frenaría a los demás.
    - Bien: ack recién después de que la transacción se confirmó."""
    try:
        event = parse_event(message.body, message.routing_key)
    except (ValidationError, SchemaValidationError, ValueError, UnicodeDecodeError, KeyError, TypeError):
        logger.warning("Invalid event rejected (routing key %s)", message.routing_key)
        await message.reject(requeue=False)
        return
    try:
        if isinstance(event, SongPlayed):
            await record_play(pool, event)
        elif isinstance(event, SongDeleted):
            await forget_song(pool, event)
        else:
            await record_event(pool, event)
    except Exception as error:
        if is_transient(error):
            logger.warning("Database unavailable (%r); retrying %s later", error, event.event_id)
            await asyncio.sleep(RETRY_DELAY_SEC)
            # If the channel closed, RabbitMQ automatically requeues the delivery.
            if not message.channel.is_closed:
                await message.nack(requeue=True)
        else:
            logger.exception("Event %s cannot be stored; sent to the dead-letter queue", event.event_id)
            await message.reject(requeue=False)
        return
    await message.ack()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncExitStack() as stack:
        pool = await open_pool()
        stack.push_async_callback(pool.close)
        await pool.execute(SCHEMA)
        broker = await aio_pika.connect_robust(
            host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
            login=os.environ["RABBITMQ_USER"],
            password=os.environ["RABBITMQ_PASS"],
            timeout=10,
        )
        stack.push_async_callback(broker.close)
        channel = await broker.channel()
        await channel.set_qos(prefetch_count=20)
        exchange = await channel.declare_exchange(
            "musicapp.events", aio_pika.ExchangeType.TOPIC, durable=True,
        )
        dead_exchange = await channel.declare_exchange(
            "musicapp.dlx", aio_pika.ExchangeType.TOPIC, durable=True,
        )
        dead_queue = await channel.declare_queue("musicapp.dlq", durable=True)
        await dead_queue.bind(dead_exchange, routing_key="#")
        queue = await channel.declare_queue(
            "metrics.q", durable=True,
            arguments={
                "x-dead-letter-exchange": "musicapp.dlx",
            },
        )
        for kind in TYPES:
            await queue.bind(exchange, routing_key=kind)

        async def consume(message: aio_pika.IncomingMessage):
            await handle(message, pool)

        consumer_tag = await queue.consume(consume)
        stack.push_async_callback(queue.cancel, consumer_tag)
        app.state.pool = pool
        app.state.broker = broker
        app.state.channel = channel
        logger.info("Consuming %s on metrics.q", ", ".join(TYPES))
        yield


app = FastAPI(title="TeroMusic Metrics", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    try:
        await app.state.pool.fetchval("SELECT 1")
        if not app.state.broker.connected.is_set() or app.state.channel.is_closed:
            raise RuntimeError("RabbitMQ unavailable")
    except Exception:
        raise HTTPException(status_code=503, detail="Dependencies unavailable") from None
    return {"status": "ok"}


@app.get("/metrics/songs/{song_id}", response_model=SongMetrics)
async def song_metrics(song_id: str = Path(min_length=1, max_length=128, pattern=r"^\S+$")):
    try:
        count = await app.state.pool.fetchval(
            "SELECT total_plays FROM analytics.song_metrics WHERE song_id = $1", song_id,
        )
    except Exception:
        logger.exception("Could not read metrics")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return SongMetrics(song_id=song_id, total_plays=count or 0)


@app.post("/metrics/songs/batch", response_model=TopSongs)
async def songs_metrics(body: SongsBatch):
    """Reproducciones de varias canciones en un solo pedido (p. ej. todas las de un
    artista). Devuelve una entrada por id pedido, en el mismo orden y sin repetidos;
    las que no tienen reproducciones vienen con 0."""
    song_ids = list(dict.fromkeys(body.song_ids))
    try:
        rows = await app.state.pool.fetch(
            "SELECT song_id, total_plays FROM analytics.song_metrics WHERE song_id = ANY($1::varchar[])",
            song_ids,
        )
    except Exception:
        logger.exception("Could not read metrics")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    counts = {row["song_id"]: row["total_plays"] for row in rows}
    return TopSongs(songs=[SongMetrics(song_id=s, total_plays=counts.get(s, 0)) for s in song_ids])


@app.get("/metrics/plays", response_model=TotalPlays)
async def total_plays():
    """Total de reproducciones de todas las canciones."""
    try:
        count = await app.state.pool.fetchval(
            # Del historial: borrar una canción no baja el total de reproducciones.
            "SELECT COUNT(*) FROM analytics.play_events",
        )
    except Exception:
        logger.exception("Could not read metrics")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return TotalPlays(plays=count)


@app.get("/metrics/top", response_model=TopSongs)
async def top_songs(limit: int = Query(default=10, ge=1, le=100)):
    """Canciones mas reproducidas, de mayor a menor."""
    try:
        rows = await app.state.pool.fetch(
            """SELECT song_id, total_plays FROM analytics.song_metrics
               ORDER BY total_plays DESC, song_id LIMIT $1""",
            limit,
        )
    except Exception:
        logger.exception("Could not read metrics")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return TopSongs(songs=[SongMetrics(**dict(row)) for row in rows])


@app.get("/metrics/summary", response_model=Summary)
async def summary():
    """Totales globales: reproducciones, usuarios registrados y salas creadas."""
    try:
        row = await app.state.pool.fetchrow(
            """SELECT
                 (SELECT COUNT(*) FROM analytics.play_events) AS plays,
                 (SELECT COUNT(DISTINCT subject_id) FROM analytics.domain_events
                   WHERE type = 'user.registered.v1') AS users,
                 (SELECT COUNT(DISTINCT subject_id) FROM analytics.domain_events
                   WHERE type = 'room.created.v1') AS rooms""",
        )
    except Exception:
        logger.exception("Could not read metrics")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return Summary(**dict(row))
