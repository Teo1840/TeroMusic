"""Publica user.registered.v1 en RabbitMQ (sobre CloudEvents, ver contracts/)."""
import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone

import pika

log = logging.getLogger("user.events")

EXCHANGE = "musicapp.events"
SOURCE = "/services/user"
TYPE = "user.registered.v1"
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
RETRY_DELAYS_SEC = (0.5, 1, 2)


def username_from_email(email: str) -> str:
    """El contrato pide username (3-32, [a-zA-Z0-9_.]); lo derivamos del email."""
    name = re.sub(r"[^a-zA-Z0-9_.]", "_", email.split("@")[0])[:32]
    return name.ljust(3, "_")


def build_event(user_id: uuid.UUID, email: str, correlation_id: str | None) -> dict:
    username = username_from_email(email)
    event = {
        "specversion": "1.0",
        "id": str(uuid.uuid4()),
        "source": SOURCE,
        "type": TYPE,
        "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "subject": f"user/{user_id}",
        "datacontenttype": "application/json",
        "dataschema": f"contracts/events/{TYPE}.schema.json",
        "data": {
            "user_id": str(user_id),
            "email": email,
            "username": username,
            "display_name": username,
        },
    }
    if correlation_id:
        event["correlationid"] = correlation_id
    return event


def publish_user_registered(user_id: uuid.UUID, email: str, correlation_id: str | None = None) -> None:
    """Se corre como BackgroundTask: el registro ya respondió al cliente.
    Si RabbitMQ no está, reintenta unas veces y lo deja en el log (no rompe el alta)."""
    event = build_event(user_id, email, correlation_id)
    body = json.dumps(event).encode()

    for attempt, delay in enumerate((0, *RETRY_DELAYS_SEC), start=1):
        time.sleep(delay)
        try:
            connection = pika.BlockingConnection(pika.URLParameters(RABBITMQ_URL))
            try:
                channel = connection.channel()
                channel.confirm_delivery()  # publish termina cuando el broker lo aceptó
                channel.exchange_declare(EXCHANGE, exchange_type="topic", durable=True)
                channel.basic_publish(
                    exchange=EXCHANGE,
                    routing_key=TYPE,  # regla del contrato: routing key = type
                    body=body,
                    properties=pika.BasicProperties(
                        content_type="application/json",
                        delivery_mode=2,  # persistente
                        message_id=event["id"],
                        correlation_id=correlation_id,
                        type=TYPE,
                    ),
                )
            finally:
                connection.close()
            log.info("Evento publicado: %s (user/%s)", TYPE, user_id)
            return
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo publicar %s (intento %d): %s", TYPE, attempt, exc)

    log.error("Se perdió %s para user/%s: RabbitMQ no disponible", TYPE, user_id)
