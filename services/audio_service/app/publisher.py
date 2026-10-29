import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

import aio_pika


EXCHANGE = "domain_events"
ROUTING_KEY = "song.played"
RETRY_DELAYS = (0.5, 1, 2)

logger = logging.getLogger("audio.publisher")


class Publisher:
    """Publica song.played con el contrato de services/metrics_service/README.md."""

    async def connect(self):
        self.connection = await aio_pika.connect_robust(
            host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
            login=os.environ["RABBITMQ_USER"],
            password=os.environ["RABBITMQ_PASS"],
            timeout=10,
        )
        # Con confirmaciones, publish() espera a que el broker acepte el mensaje.
        self.channel = await self.connection.channel(publisher_confirms=True)
        self.exchange = await self.channel.declare_exchange(
            EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True,
        )

    async def close(self):
        await self.connection.close()

    def is_ready(self) -> bool:
        return self.connection.connected.is_set() and not self.channel.is_closed

    async def publish_song_played(self, song_id: str, user_id: str) -> str:
        event_id = str(uuid4())
        body = json.dumps({
            "event_id": event_id,
            "song_id": song_id,
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }).encode()
        # Los reintentos reutilizan el mismo event_id para que metrics no cuente dos veces.
        for attempt, delay in enumerate((*RETRY_DELAYS, None), start=1):
            try:
                await self.exchange.publish(
                    aio_pika.Message(
                        body,
                        content_type="application/json",
                        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                        message_id=event_id,
                    ),
                    routing_key=ROUTING_KEY,
                    timeout=5,
                )
                return event_id
            except Exception:
                if delay is None:
                    raise
                logger.warning("Publish attempt %s failed; retrying", attempt)
                await asyncio.sleep(delay)
