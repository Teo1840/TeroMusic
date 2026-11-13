"""Run with: docker compose exec -T metrics_service python -m tests.integration"""
import asyncio
import json
from datetime import datetime, timezone
from urllib.request import urlopen
from uuid import uuid4

import aio_pika

from app.database import open_pool
import os


def get_json(path):
    with urlopen(f"http://localhost:8000{path}", timeout=5) as response:
        return json.load(response)


def get_metrics(song_id):
    return get_json(f"/metrics/songs/{song_id}")


async def main():
    song_id = str(uuid4())
    pool = await open_pool()
    broker = await aio_pika.connect_robust(
        host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
        login=os.environ["RABBITMQ_USER"], password=os.environ["RABBITMQ_PASS"],
    )
    domain_ids = []
    try:
        assert get_metrics(song_id) == {"song_id": song_id, "total_plays": 0}
        plays_before = get_json("/metrics/plays")["plays"]
        channel = await broker.channel()
        exchange = await channel.get_exchange("musicapp.events")
        # Start with the team's canonical example, including its full envelope.
        from pathlib import Path
        event = json.loads(Path("contracts/examples/song.played.v1.example.json").read_text())
        event["data"]["song_id"] = song_id
        event["data"]["user_id"] = str(uuid4())
        async def publish(payload):
            await exchange.publish(aio_pika.Message(
                body=json.dumps(payload).encode(), content_type="application/json",
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ), routing_key="song.played.v1")

        # Distinct plays, concurrent delivery, and duplicate event ID.
        first = {**event, "id": str(uuid4())}
        await publish(first)
        await publish(first)
        await asyncio.gather(*(publish({**event, "id": str(uuid4())}) for _ in range(9)))
        for _ in range(100):
            await asyncio.sleep(0.1)
            if get_metrics(song_id)["total_plays"] == 10:
                break
        assert get_metrics(song_id)["total_plays"] == 10, get_metrics(song_id)
        assert await pool.fetchval(
            "SELECT COUNT(*) FROM analytics.play_events WHERE song_id=$1", song_id,
        ) == 10
        # Global total and ranking include this test's plays (other songs may change meanwhile).
        assert get_json("/metrics/plays")["plays"] >= plays_before + 10
        top = get_json("/metrics/top?limit=100")["songs"]
        counts = [s["total_plays"] for s in top]
        assert counts == sorted(counts, reverse=True), counts
        if len(top) < 100:
            assert {"song_id": song_id, "total_plays": 10} in top, top
        # Invalid events must not increment and must reach the dead-letter queue.
        invalid_id = str(uuid4())
        await publish({**event, "id": invalid_id, "data": {"song_id": song_id}})
        # Match this test's event rather than assuming the error queue was empty.
        dead = await channel.get_queue("musicapp.dlq")
        unrelated = []
        try:
            for _ in range(100):
                message = await dead.get(fail=False)
                if message is not None:
                    try:
                        is_test_event = json.loads(message.body).get("id") == invalid_id
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
        assert get_metrics(song_id)["total_plays"] == 10

        # Usuarios registrados y salas creadas: se cuentan una vez cada uno, aunque llegue repetido.
        before = get_json("/metrics/summary")
        for kind in ("user.registered.v1", "room.created.v1"):
            other = json.loads(Path(f"contracts/examples/{kind}.example.json").read_text())
            other["id"] = str(uuid4())
            key = "user_id" if kind == "user.registered.v1" else "room_id"
            other["data"][key] = str(uuid4())
            domain_ids.append(other["id"])
            for _ in range(2):
                await exchange.publish(aio_pika.Message(
                    body=json.dumps(other).encode(), content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ), routing_key=kind)
        for _ in range(100):
            await asyncio.sleep(0.1)
            after = get_json("/metrics/summary")
            if after["users"] >= before["users"] + 1 and after["rooms"] >= before["rooms"] + 1:
                break
        assert after["users"] == before["users"] + 1, (before, after)
        assert after["rooms"] == before["rooms"] + 1, (before, after)
        print("PASS: zero plays, total plays, top songs, AMQP -> PostgreSQL -> REST, concurrency, deduplication, CloudEvents validation, invalid events, users and rooms summary")
    finally:
        await broker.close()
        await pool.execute("DELETE FROM analytics.play_events WHERE song_id=$1", song_id)
        await pool.execute("DELETE FROM analytics.song_metrics WHERE song_id=$1", song_id)
        await pool.execute("DELETE FROM analytics.domain_events WHERE event_id=ANY($1::varchar[])", domain_ids)
        await pool.close()


asyncio.run(main())
