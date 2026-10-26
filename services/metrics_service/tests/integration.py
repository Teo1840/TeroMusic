"""Run with: docker compose exec -T metrics_service python -m tests.integration"""
import asyncio
import json
from datetime import datetime, timezone
from urllib.request import urlopen
from uuid import uuid4

import aio_pika

from app.database import open_pool
import os


def get_metrics(song_id):
    with urlopen(f"http://localhost:8000/metrics/songs/{song_id}", timeout=5) as response:
        return json.load(response)


async def main():
    song_id = "integration-" + str(uuid4())
    pool = await open_pool()
    broker = await aio_pika.connect_robust(
        host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
        login=os.environ["RABBITMQ_USER"], password=os.environ["RABBITMQ_PASS"],
    )
    try:
        assert get_metrics(song_id) == {"song_id": song_id, "total_plays": 0}
        channel = await broker.channel()
        exchange = await channel.get_exchange("domain_events")
        event = {
            "song_id": song_id, "user_id": "test-user",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        async def publish(payload):
            await exchange.publish(aio_pika.Message(
                body=json.dumps(payload).encode(), content_type="application/json",
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ), routing_key="song.played")

        # Distinct plays, concurrent delivery, and duplicate event ID.
        first = {**event, "event_id": str(uuid4())}
        await publish(first)
        await publish(first)
        await asyncio.gather(*(publish({**event, "event_id": str(uuid4())}) for _ in range(9)))
        # Original contract without event_id is also supported.
        await publish(event)
        for _ in range(100):
            await asyncio.sleep(0.1)
            if get_metrics(song_id)["total_plays"] == 11:
                break
        assert get_metrics(song_id)["total_plays"] == 11, get_metrics(song_id)
        assert await pool.fetchval(
            "SELECT COUNT(*) FROM analytics.play_events WHERE song_id=$1", song_id,
        ) == 11
        # Invalid events must not increment and must reach the dead-letter queue.
        invalid_id = str(uuid4())
        await publish({"song_id": song_id, "event_id": invalid_id})
        # Match this test's event rather than assuming the error queue was empty.
        dead = await channel.get_queue("metrics.song.played.invalid")
        unrelated = []
        try:
            for _ in range(100):
                message = await dead.get(fail=False)
                if message is not None:
                    try:
                        is_test_event = json.loads(message.body).get("event_id") == invalid_id
                    except (ValueError, AttributeError):
                        is_test_event = False
                    if is_test_event:
                        await message.ack()
                        break
                    unrelated.append(message)
                await asyncio.sleep(0.1)
            else:
                raise AssertionError("Invalid message did not reach dead-letter queue")
        finally:
            for message in unrelated:
                await message.nack(requeue=True)
        assert get_metrics(song_id)["total_plays"] == 11
        print("PASS: zero plays, AMQP -> PostgreSQL -> REST, concurrency, deduplication, invalid events")
    finally:
        await broker.close()
        await pool.execute("DELETE FROM analytics.play_events WHERE song_id=$1", song_id)
        await pool.execute("DELETE FROM analytics.song_metrics WHERE song_id=$1", song_id)
        await pool.close()


asyncio.run(main())
