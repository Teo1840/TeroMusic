"""Publicador de eventos a RabbitMQ (sobre CloudEvents 1.0, ver contracts/)."""
import json
import logging
import uuid
from datetime import datetime, timezone

import aio_pika

from .config import settings

log = logging.getLogger("catalog.publisher")

SOURCE = "/services/catalog"

_connection: aio_pika.abc.AbstractRobustConnection | None = None
_exchange: aio_pika.abc.AbstractExchange | None = None


async def connect() -> None:
    """Abre la conexión y declara el exchange y la cola del worker."""
    global _connection, _exchange
    _connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await _connection.channel()  # con confirmaciones de publicación
    _exchange = await channel.declare_exchange(
        settings.events_exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )

    # Declaramos la cola del worker para que los eventos no se pierdan si el
    # worker aún no está corriendo. Debe declararse IGUAL en worker_ingesta.
    queue = await channel.declare_queue(
        "worker_ingesta.q",
        durable=True,
        arguments={"x-dead-letter-exchange": "musicapp.dlx"},
    )
    await queue.bind(_exchange, routing_key="audio.uploaded.v1")
    log.info("RabbitMQ listo: exchange %s", settings.events_exchange)


async def close() -> None:
    if _connection is not None:
        await _connection.close()


def build_event(
    event_type: str, data: dict, subject: str, correlation_id: str
) -> dict:
    """Arma el sobre CloudEvents que exige contracts/envelope.schema.json."""
    return {
        "specversion": "1.0",
        "id": str(uuid.uuid4()),
        "source": SOURCE,
        "type": event_type,
        "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "subject": subject,
        "datacontenttype": "application/json",
        "dataschema": f"contracts/events/{event_type}.schema.json",
        "correlationid": correlation_id,
        "data": data,
    }


async def publish(
    event_type: str, data: dict, subject: str, correlation_id: str
) -> dict:
    if _exchange is None:
        raise RuntimeError("RabbitMQ no está conectado")

    event = build_event(event_type, data, subject, correlation_id)
    message = aio_pika.Message(
        body=json.dumps(event).encode(),
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        message_id=event["id"],
        correlation_id=correlation_id,
        type=event_type,
    )
    # routing key = type del evento (regla del contrato)
    await _exchange.publish(message, routing_key=event_type)
    log.info("Evento publicado: %s (%s)", event_type, subject)
    return event
