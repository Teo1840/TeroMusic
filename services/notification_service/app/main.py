import asyncio
import logging
import os
from contextlib import AsyncExitStack, asynccontextmanager

import aio_pika
from fastapi import FastAPI, Header, HTTPException, Query
from pydantic import ValidationError
from jsonschema.exceptions import ValidationError as SchemaValidationError

from app.database import SCHEMA, is_transient, open_pool, record_event
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
from app.events import TYPES, parse_event


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("notifications")

RETRY_DELAY_SEC = 2


async def handle(message, pool):
    """Procesa un mensaje de notifications.q y lo confirma, reintenta o descarta.

    - Inválido (no cumple el contrato): a la cola de errores, sin reintentar.
    - Error pasajero de la base: vuelve a la cola después de una pausa.
    - Cualquier otro error: a la cola de errores. Reintentar un mensaje que falla
      siempre lo dejaría dando vueltas para siempre y frenaría a los demás.
    - Bien: ack recién después de que la transacción se confirmó."""
    try:
        event = parse_event(message.body, message.routing_key)
    except (ValidationError, SchemaValidationError, ValueError, UnicodeDecodeError, KeyError, TypeError):
        logger.warning("Invalid notification event rejected (routing key %s)", message.routing_key)
        await message.reject(requeue=False)
        return
    try:
        await record_event(pool, event)
    except Exception as error:
        if is_transient(error):
            logger.warning("Database unavailable (%r); retrying %s later", error, event["id"])
            await asyncio.sleep(RETRY_DELAY_SEC)
            # If the channel closed, RabbitMQ automatically requeues the delivery.
            if not message.channel.is_closed:
                await message.nack(requeue=True)
        else:
            logger.exception("Notification %s cannot be stored; sent to the dead-letter queue", event["id"])
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
            "notifications.q", durable=True,
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
        logger.info("Consuming notification events on notifications.q")
        yield


app = FastAPI(title="TeroMusic Notifications", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    try:
        await app.state.pool.fetchval("SELECT 1")
        if not app.state.broker.connected.is_set() or app.state.channel.is_closed:
            raise RuntimeError("RabbitMQ unavailable")
    except Exception:
        raise HTTPException(status_code=503, detail="Dependencies unavailable") from None
    return {"status": "ok"}


class Notification(BaseModel):
    id: int
    event_id: UUID
    user_id: UUID
    type: str
    message: str
    resource_id: UUID | None
    created_at: datetime
    received_at: datetime


@app.get("/notifications/user/{user_id}", response_model=list[Notification])
async def user_notifications(user_id: UUID, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), x_user_id: UUID | None = Header(default=None)):
    if x_user_id is not None and x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read another user's notifications")
    try:
        rows = await app.state.pool.fetch(
            """SELECT * FROM notifications.history WHERE user_id=$1
            ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3""", user_id, limit, offset)
    except Exception:
        logger.exception("Could not read notifications")
        raise HTTPException(status_code=503, detail="Database unavailable") from None
    return [dict(row) for row in rows]
