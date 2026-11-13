"""Publica los eventos de user_service en RabbitMQ (sobre CloudEvents, ver contracts/)."""
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
REGISTERED = "user.registered.v1"
PROFILE_UPDATED = "user.profile_updated.v1"
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
RETRY_DELAYS_SEC = (0.5, 1, 2)


def username_from_email(email: str) -> str:
    """El contrato pide username (3-32, [a-zA-Z0-9_.]); lo derivamos del email."""
    name = re.sub(r"[^a-zA-Z0-9_.]", "_", email.split("@")[0])[:32]
    return name.ljust(3, "_")


def rfc3339(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_event(event_type: str, user_id: uuid.UUID, data: dict, correlation_id: str | None) -> dict:
    event = {
        "specversion": "1.0",
        "id": str(uuid.uuid4()),
        "source": SOURCE,
        "type": event_type,
        "time": rfc3339(datetime.now(timezone.utc)),
        "subject": f"user/{user_id}",
        "datacontenttype": "application/json",
        "dataschema": f"contracts/events/{event_type}.schema.json",
        "data": data,
    }
    if correlation_id:
        event["correlationid"] = correlation_id
    return event


def registered_data(user_id: uuid.UUID, email: str, display_name: str) -> dict:
    return {
        "user_id": str(user_id),
        "email": email,
        "username": username_from_email(email),
        "display_name": display_name,
    }


def profile_data(user_id: uuid.UUID, email: str, display_name: str, updated_at: datetime) -> dict:
    return {
        "user_id": str(user_id),
        "username": username_from_email(email),
        "display_name": display_name,
        "updated_at": rfc3339(updated_at),
    }


def publish(
    event_type: str,
    user_id: uuid.UUID,
    data: dict,
    correlation_id: str | None = None,
    mandatory: bool = False,
) -> bool:
    """Se corre como BackgroundTask: la petición ya respondió al cliente.
    Si RabbitMQ no está, reintenta unas veces y lo deja en el log. Devuelve si se publicó.
    mandatory=True: también falla si ninguna cola recibe el evento (consumidor sin bindings)."""
    event = build_event(event_type, user_id, data, correlation_id)
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
                    routing_key=event_type,  # regla del contrato: routing key = type
                    body=body,
                    mandatory=mandatory,
                    properties=pika.BasicProperties(
                        content_type="application/json",
                        delivery_mode=2,  # persistente
                        message_id=event["id"],
                        correlation_id=correlation_id,
                        type=event_type,
                    ),
                )
            finally:
                connection.close()
            log.info("Evento publicado: %s (user/%s)", event_type, user_id)
            return True
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo publicar %s (intento %d): %s", event_type, attempt, exc)

    log.error("Se perdió %s para user/%s: RabbitMQ no disponible", event_type, user_id)
    return False
