import asyncio
import logging
import os
from contextlib import AsyncExitStack, asynccontextmanager

import aio_pika
from fastapi import FastAPI, HTTPException, Path
from pydantic import ValidationError

from app.database import SCHEMA, open_pool, record_play
from app.models import SongMetrics, SongPlayed


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("metrics")


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
            "domain_events", aio_pika.ExchangeType.TOPIC, durable=True,
        )
        await channel.declare_queue("metrics.song.played.invalid", durable=True)
        queue = await channel.declare_queue(
            "metrics.song.played", durable=True,
            arguments={
                "x-dead-letter-exchange": "",
                "x-dead-letter-routing-key": "metrics.song.played.invalid",
            },
        )
        await queue.bind(exchange, routing_key="song.played")

        async def consume(message: aio_pika.IncomingMessage):
            try:
                event = SongPlayed.model_validate_json(message.body)
                if message.message_id and len(message.message_id) > 128:
                    raise ValueError("message_id exceeds 128 characters")
            except (ValidationError, ValueError):
                logger.warning("Invalid song.played message rejected")
                await message.reject(requeue=False)
                return
            try:
                await record_play(pool, event, message.message_id)
            except Exception:
                logger.exception("Could not persist play; retrying after backoff")
                await asyncio.sleep(2)
                # If the channel closed, RabbitMQ automatically requeues the delivery.
                if not message.channel.is_closed:
                    await message.nack(requeue=True)
                return
            # Acknowledge only after the database transaction has committed.
            await message.ack()

        consumer_tag = await queue.consume(consume)
        stack.push_async_callback(queue.cancel, consumer_tag)
        app.state.pool = pool
        app.state.broker = broker
        app.state.channel = channel
        logger.info("Consuming domain_events/song.played")
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
