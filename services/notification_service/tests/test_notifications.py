import asyncio
import json
import unittest
from uuid import UUID, uuid4
from jsonschema.exceptions import ValidationError
from app.events import CONTRACTS, TYPES, parse_event
from app.database import SCHEMA, open_pool, record_event
from fastapi import HTTPException
from app.main import MarkRead, app, mark_read, unread_count, user_notifications


def example(kind):
    event = json.loads((CONTRACTS / f"examples/{kind}.example.json").read_text(encoding="utf-8"))
    event["id"] = str(uuid4())
    return event


class ContractsTest(unittest.TestCase):
    def test_examples(self):
        for kind in TYPES:
            with self.subTest(kind=kind):
                event = example(kind)
                self.assertEqual(parse_event(json.dumps(event).encode(), kind), event)

    def test_reject_invalid(self):
        event = example("user.registered.v1")
        with self.assertRaises(ValueError):
            parse_event(json.dumps(event).encode(), "room.created.v1")
        event["data"]["user_id"] = "bad-id"
        with self.assertRaises(ValidationError):
            parse_event(json.dumps(event).encode(), event["type"])
        for body in (b"null", b"[]", b"{}", b"broken"):
            with self.assertRaises((ValidationError, ValueError)):
                parse_event(body, "user.registered.v1")


class PersistenceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pool = await open_pool()
        await self.pool.execute(SCHEMA)
        self.ids = []
        self.songs = []
        app.state.pool = self.pool

    async def asyncTearDown(self):
        await self.pool.execute("DELETE FROM notifications.history WHERE event_id=ANY($1::uuid[])", self.ids)
        await self.pool.execute("DELETE FROM notifications.events WHERE event_id=ANY($1::uuid[])", self.ids)
        await self.pool.execute("DELETE FROM notifications.uploads WHERE song_id=ANY($1::uuid[])", self.songs)
        await self.pool.close()

    async def save(self, event):
        self.ids.append(UUID(event["id"]))
        await record_event(self.pool, event)

    async def test_welcome_duplicate_and_user_isolation(self):
        event = example("user.registered.v1")
        user = uuid4()
        event["data"]["user_id"] = str(user)
        await self.save(event)
        await self.save(event)
        rows = await user_notifications(user, 50, 0, None)
        self.assertEqual(len(rows), 1)
        self.assertIn("Bienvenido", rows[0]["message"])
        self.assertEqual(await user_notifications(uuid4(), 50, 0, None), [])
        self.assertEqual(await user_notifications(user, 50, 1, None), [])
        # Con el header del gateway: el propio usuario lee, otro recibe 403.
        self.assertEqual(len(await user_notifications(user, 50, 0, user)), 1)
        with self.assertRaises(HTTPException) as denied:
            await user_notifications(user, 50, 0, uuid4())
        self.assertEqual(denied.exception.status_code, 403)

    async def test_audio_order_and_concurrent_delivery(self):
        for mode in ("upload-first", "result-first", "concurrent"):
            song, user = uuid4(), uuid4()
            self.songs.append(song)
            upload, ready = example("audio.uploaded.v1"), example("audio.ready.v1")
            upload["data"].update(song_id=str(song), uploaded_by=str(user))
            ready["data"]["song_id"] = str(song)
            if mode == "concurrent":
                await asyncio.gather(self.save(upload), self.save(ready))
            else:
                first, second = (upload, ready) if mode == "upload-first" else (ready, upload)
                await self.save(first)
                await self.save(second)
            await self.save(ready)
            rows = await user_notifications(user, 50, 0, None)
            self.assertEqual(len(rows), 1, mode)
            self.assertEqual(rows[0]["type"], "audio.ready.v1")

    async def test_room_and_failed_audio(self):
        room = example("room.created.v1")
        user = uuid4()
        room["data"]["host_id"] = str(user)
        await self.save(room)
        self.assertEqual(len(await user_notifications(user, 50, 0, None)), 1)
        song = uuid4()
        self.songs.append(song)
        upload, failed = example("audio.uploaded.v1"), example("audio.failed.v1")
        upload["data"].update(song_id=str(song), uploaded_by=str(user))
        failed["data"]["song_id"] = str(song)
        await self.save(failed)
        await self.save(upload)
        rows = await user_notifications(user, 50, 0, None)
        self.assertEqual({row["type"] for row in rows}, {"room.created.v1", "audio.failed.v1"})

    async def test_admin_borra_cancion_avisa_al_artista(self):
        song, artist, admin = uuid4(), uuid4(), uuid4()
        event = example("song.deleted.v1")
        event["data"].update(song_id=str(song), artist_id=str(artist), deleted_by=str(admin), title="Mi tema")
        await self.save(event)
        await self.save(event)  # repetido: un solo aviso
        rows = await user_notifications(artist, 50, 0, None)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["type"], "song.deleted.v1")
        self.assertIn("Mi tema", rows[0]["message"])
        self.assertEqual(rows[0]["resource_id"], song)
        # Al admin no le llega nada.
        self.assertEqual(await user_notifications(admin, 50, 0, None), [])

    async def test_artista_que_borra_lo_suyo_no_recibe_aviso(self):
        artist = uuid4()
        event = example("song.deleted.v1")
        event["data"].update(song_id=str(uuid4()), artist_id=str(artist), deleted_by=str(artist))
        await self.save(event)
        self.assertEqual(await user_notifications(artist, 50, 0, None), [])

    async def welcome(self, user):
        event = example("user.registered.v1")
        event["data"]["user_id"] = str(user)
        await self.save(event)

    async def room(self, user):
        event = example("room.created.v1")
        event["data"]["host_id"] = str(user)
        await self.save(event)

    async def test_unread_count_and_mark_read(self):
        user, other = uuid4(), uuid4()
        await self.welcome(user)
        await self.room(user)
        await self.room(other)
        self.assertEqual((await unread_count(user, None)).unread, 2)
        rows = await user_notifications(user, 50, 0, None)
        self.assertTrue(all(row["read_at"] is None for row in rows))

        # Una sola, por id. Un id de otro usuario se ignora.
        others = await user_notifications(other, 50, 0, None)
        result = await mark_read(user, MarkRead(ids=[rows[0]["id"], others[0]["id"]]), None)
        self.assertEqual(result.unread, 1)
        self.assertEqual((await unread_count(other, None)).unread, 1)
        first_read = (await user_notifications(user, 50, 0, None))[0]["read_at"]
        self.assertIsNotNone(first_read)

        # Todas; repetir no cambia el read_at de la que ya estaba leída.
        self.assertEqual((await mark_read(user, None, None)).unread, 0)
        self.assertEqual((await mark_read(user, MarkRead(), None)).unread, 0)
        self.assertEqual((await user_notifications(user, 50, 0, None))[0]["read_at"], first_read)
        self.assertEqual((await mark_read(user, MarkRead(ids=[]), None)).unread, 0)

        for call in (unread_count(user, other), mark_read(user, None, other)):
            with self.assertRaises(HTTPException) as denied:
                await call
            self.assertEqual(denied.exception.status_code, 403)

    async def test_deleted_account_loses_its_notifications(self):
        user, other = uuid4(), uuid4()
        await self.welcome(user)
        await self.welcome(other)
        song = uuid4()
        self.songs.append(song)
        upload = example("audio.uploaded.v1")
        upload["data"].update(song_id=str(song), uploaded_by=str(user))
        await self.save(upload)

        deleted = example("user.deleted.v1")
        deleted["data"]["user_id"] = str(user)
        await self.save(deleted)
        await self.save(deleted)
        self.assertEqual(await user_notifications(user, 50, 0, None), [])
        self.assertEqual(len(await user_notifications(other, 50, 0, None)), 1)
        self.assertIsNone(await self.pool.fetchval(
            "SELECT user_id FROM notifications.uploads WHERE song_id=$1", song))

    async def test_broker_to_http(self):
        import os
        import urllib.request
        import urllib.error
        import aio_pika
        event = example("user.registered.v1")
        user = uuid4()
        event["data"]["user_id"] = str(user)
        self.ids.append(UUID(event["id"]))
        broker = await aio_pika.connect_robust(
            host=os.getenv("RABBITMQ_HOST", "rabbitmq"),
            login=os.environ["RABBITMQ_USER"], password=os.environ["RABBITMQ_PASS"])
        try:
            channel = await broker.channel()
            exchange = await channel.get_exchange("musicapp.events")
            for _ in range(2):
                await exchange.publish(aio_pika.Message(
                    body=json.dumps(event).encode(), delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
                    routing_key=event["type"])
            def get(path):
                with urllib.request.urlopen("http://localhost:8000" + path, timeout=3) as response:
                    return json.load(response)
            for _ in range(50):
                rows = await asyncio.to_thread(get, f"/notifications/user/{user}")
                if rows:
                    break
                await asyncio.sleep(0.1)
            self.assertEqual(len(rows), 1)
            await asyncio.sleep(0.2)
            self.assertEqual(len(await asyncio.to_thread(get, f"/notifications/user/{user}")), 1)
            self.assertEqual(await asyncio.to_thread(get, "/health"), {"status": "ok"})
            for path in ("/notifications/user/bad-id", f"/notifications/user/{user}?limit=0"):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    await asyncio.to_thread(get, path)
                self.assertEqual(caught.exception.code, 422)
        finally:
            await broker.close()
