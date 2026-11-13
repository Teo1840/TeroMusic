"""Qué hace el consumidor con cada mensaje: ack, reintento o cola de errores (sin base ni RabbitMQ)."""
import json
import unittest
from unittest import mock
from uuid import uuid4

import asyncpg

from app import main
from app.events import CONTRACTS


class FakeChannel:
    is_closed = False


class FakeMessage:
    def __init__(self, event, routing_key=None):
        self.body = json.dumps(event).encode() if isinstance(event, dict) else event
        self.routing_key = routing_key or (event["type"] if isinstance(event, dict) else "user.registered.v1")
        self.channel = FakeChannel()
        self.outcome = None

    async def ack(self):
        self.outcome = "ack"

    async def nack(self, requeue):
        self.outcome = "requeue" if requeue else "dead"

    async def reject(self, requeue):
        self.outcome = "requeue" if requeue else "dead"


def welcome():
    event = json.loads((CONTRACTS / "examples/user.registered.v1.example.json").read_text(encoding="utf-8"))
    event["id"] = str(uuid4())
    return event


class HandleTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.RETRY_DELAY_SEC = 0

    async def run_with(self, message, error=None):
        record = mock.AsyncMock(side_effect=error)
        with mock.patch.object(main, "record_event", record):
            await main.handle(message, pool=None)
        return message.outcome, record

    async def test_valido_se_guarda_y_confirma(self):
        outcome, record = await self.run_with(FakeMessage(welcome()))
        self.assertEqual(outcome, "ack")
        record.assert_awaited_once()

    async def test_invalido_va_a_la_cola_de_errores_sin_tocar_la_base(self):
        for body in (b"no es json", b"null", b"{}"):
            with self.subTest(body=body):
                outcome, record = await self.run_with(FakeMessage(body))
                self.assertEqual(outcome, "dead")
                record.assert_not_awaited()

    async def test_base_caida_vuelve_a_la_cola(self):
        for error in (ConnectionRefusedError(), TimeoutError(), asyncpg.TooManyConnectionsError(),
                      asyncpg.DeadlockDetectedError()):
            with self.subTest(error=type(error).__name__):
                outcome, _ = await self.run_with(FakeMessage(welcome()), error)
                self.assertEqual(outcome, "requeue")

    async def test_error_permanente_va_a_la_cola_de_errores_en_vez_de_reintentar_siempre(self):
        for error in (asyncpg.DataError(), asyncpg.UniqueViolationError(), KeyError("x"), ValueError()):
            with self.subTest(error=type(error).__name__):
                outcome, _ = await self.run_with(FakeMessage(welcome()), error)
                self.assertEqual(outcome, "dead")

    async def test_canal_cerrado_no_hace_nack(self):
        message = FakeMessage(welcome())
        message.channel.is_closed = True
        outcome, _ = await self.run_with(message, ConnectionResetError())
        self.assertIsNone(outcome)  # RabbitMQ lo reentrega solo


if __name__ == "__main__":
    unittest.main()
