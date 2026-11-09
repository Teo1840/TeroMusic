"""Publica audio.ready.v1 y audio.failed.v1 (sobre CloudEvents del contrato)."""
import json
import logging
import uuid
from datetime import datetime, timezone

import aio_pika

log = logging.getLogger("worker.publisher")

SOURCE = "/services/worker-ingesta"

_exchange: aio_pika.abc.AbstractExchange | None = None


def init(exchange: aio_pika.abc.AbstractExchange) -> None:
    global _exchange
    _exchange = exchange


def build_event(event_type: str, data: dict, subject: str, correlation_id: str) -> dict:
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


async def publish(event_type: str, data: dict, subject: str, correlation_id: str) -> dict:
    if _exchange is None:
        raise RuntimeError("Publisher sin inicializar")
    event = build_event(event_type, data, subject, correlation_id)
    message = aio_pika.Message(
        body=json.dumps(event).encode(),
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        message_id=event["id"],
        correlation_id=correlation_id,
        type=event_type,
    )
    await _exchange.publish(message, routing_key=event_type)
    log.info("Evento publicado: %s (%s)", event_type, subject)
    return event
