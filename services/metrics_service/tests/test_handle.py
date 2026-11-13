"""Consumidor de métricas: qué evento va a qué tabla y qué pasa con cada error (sin base ni RabbitMQ)."""
import json
import unittest
from unittest import mock
from uuid import uuid4

import asyncpg
from fastapi.testclient import TestClient

from app import main
from app.events import CONTRACTS, TYPES, parse_event
from app.models import DomainEvent, SongDeleted, SongPlayed


def example(kind):
    event = json.loads((CONTRACTS / f"examples/{kind}.example.json").read_text(encoding="utf-8"))
    event["id"] = str(uuid4())
    return event


class FakeChannel:
    is_closed = False


class FakeMessage:
    def __init__(self, event, routing_key=None):
        self.body = json.dumps(event).encode() if isinstance(event, dict) else event
        self.routing_key = routing_key or (event["type"] if isinstance(event, dict) else "song.played.v1")
        self.channel = FakeChannel()
        self.outcome = None

    async def ack(self):
        self.outcome = "ack"

    async def nack(self, requeue):
        self.outcome = "requeue" if requeue else "dead"

    async def reject(self, requeue):
        self.outcome = "requeue" if requeue else "dead"


class ParseTest(unittest.TestCase):
    def test_consume_los_eventos_del_contrato(self):
        self.assertEqual(set(TYPES), {"song.played.v1", "song.deleted.v1", "user.registered.v1",
                                      "room.created.v1", "user.deleted.v1"})

    def test_cuenta_borrada_se_cuenta_por_usuario(self):
        deleted = parse_event(json.dumps(example("user.deleted.v1")).encode(), "user.deleted.v1")
        self.assertIsInstance(deleted, DomainEvent)
        self.assertEqual(deleted.type, "user.deleted.v1")
        self.assertEqual(deleted.subject_id, "5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60")

    def test_registro_y_sala_se_cuentan_por_usuario_y_por_sala(self):
        user = parse_event(json.dumps(example("user.registered.v1")).encode(), "user.registered.v1")
        room = parse_event(json.dumps(example("room.created.v1")).encode(), "room.created.v1")
        self.assertIsInstance(user, DomainEvent)
        self.assertEqual(user.subject_id, "5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60")
        self.assertEqual(room.subject_id, "77aa88bb-99cc-4dd0-8eef-112233445566")

    def test_reproduccion_sigue_siendo_song_played(self):
        play = parse_event(json.dumps(example("song.played.v1")).encode(), "song.played.v1")
        self.assertIsInstance(play, SongPlayed)

    def test_routing_key_distinto_al_tipo_se_rechaza(self):
        with self.assertRaises(ValueError):
            parse_event(json.dumps(example("room.created.v1")).encode(), "user.registered.v1")


class HandleTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.RETRY_DELAY_SEC = 0

    async def run_with(self, message, error=None):
        play = mock.AsyncMock(side_effect=error)
        other = mock.AsyncMock(side_effect=error)
        self.forget = mock.AsyncMock(side_effect=error)
        with mock.patch.object(main, "record_play", play), mock.patch.object(main, "record_event", other),                 mock.patch.object(main, "forget_song", self.forget):
            await main.handle(message, pool=None)
        return message.outcome, play, other

    async def test_cancion_borrada_sale_de_los_contadores(self):
        event = example("song.deleted.v1")
        outcome, play, other = await self.run_with(FakeMessage(event))
        self.assertEqual(outcome, "ack")
        self.forget.assert_awaited_once()
        deleted = self.forget.await_args.args[1]
        self.assertIsInstance(deleted, SongDeleted)
        self.assertEqual(deleted.song_id, event["data"]["song_id"])
        play.assert_not_awaited()
        other.assert_not_awaited()

    async def test_cada_evento_va_a_su_tabla(self):
        outcome, play, other = await self.run_with(FakeMessage(example("song.played.v1")))
        self.assertEqual((outcome, play.await_count, other.await_count), ("ack", 1, 0))
        for kind in ("user.registered.v1", "room.created.v1"):
            with self.subTest(kind=kind):
                outcome, play, other = await self.run_with(FakeMessage(example(kind)))
                self.assertEqual((outcome, play.await_count, other.await_count), ("ack", 0, 1))

    async def test_invalido_va_a_la_cola_de_errores(self):
        for body in (b"no es json", b"null", b"[]"):
            with self.subTest(body=body):
                outcome, play, other = await self.run_with(FakeMessage(body))
                self.assertEqual(outcome, "dead")
                play.assert_not_awaited()

    async def test_base_caida_vuelve_a_la_cola(self):
        for error in (ConnectionRefusedError(), TimeoutError(), asyncpg.CannotConnectNowError(),
                      asyncpg.SerializationError()):
            with self.subTest(error=type(error).__name__):
                outcome, _, _ = await self.run_with(FakeMessage(example("song.played.v1")), error)
                self.assertEqual(outcome, "requeue")

    async def test_error_permanente_va_a_la_cola_de_errores_en_vez_de_reintentar_siempre(self):
        for error in (asyncpg.DataError(), asyncpg.StringDataRightTruncationError(), RuntimeError()):
            with self.subTest(error=type(error).__name__):
                outcome, _, _ = await self.run_with(FakeMessage(example("room.created.v1")), error)
                self.assertEqual(outcome, "dead")


class FakePool:
    def __init__(self, fail=False):
        self.fail = fail

    async def fetchrow(self, query):
        if self.fail:
            raise ConnectionError("PostgreSQL caído")
        return {"plays": 42, "users": 7, "rooms": 3}


class SummaryTest(unittest.TestCase):
    def test_resumen(self):
        main.app.state.pool = FakePool()
        response = TestClient(main.app).get("/metrics/summary")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"plays": 42, "users": 7, "rooms": 3})

    def test_base_caida_503(self):
        main.app.state.pool = FakePool(fail=True)
        self.assertEqual(TestClient(main.app).get("/metrics/summary").status_code, 503)


if __name__ == "__main__":
    unittest.main()
