"""Reintentos, idempotencia y manejo de mensajes del worker (sin RabbitMQ ni MinIO)."""
import asyncio
import json
import uuid

import pytest

from app import publisher, worker
from app.audio_processor import ProcessingError
from app.config import settings
from app.processed import ProcessedRegistry

SONG = str(uuid.uuid4())
DATA = {"song_id": SONG, "original_key": f"raw/{SONG}.wav", "bucket": "audio"}
READY = {"song_id": SONG, "duration_sec": 2.0, "renditions": [], "processing_ms": 10}


class FakeMessage:
    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.result = None

    async def ack(self):
        self.result = "ack"

    async def reject(self, requeue=False):
        self.result = f"reject(requeue={requeue})"

    async def nack(self, requeue=True):
        self.result = f"nack(requeue={requeue})"


@pytest.fixture(autouse=True)
def no_waits(monkeypatch):
    """Sin esperas entre reintentos y con la memoria de eventos vacía en cada test."""
    async def no_sleep(_):
        pass

    monkeypatch.setattr(worker.asyncio, "sleep", no_sleep)
    # Registro de eventos solo en memoria y vacío (sin Redis).
    monkeypatch.setattr(worker, "registry", ProcessedRegistry(None, 60))


def fake_process(*outcomes):
    """process_song que devuelve o lanza cada resultado en orden. Anota las llamadas."""
    calls = []
    pending = list(outcomes)

    async def process(data):
        calls.append(data)
        outcome = pending.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return process, calls


@pytest.fixture
def published(monkeypatch):
    events = []

    async def fake_publish(event_type, data, subject, correlation_id):
        events.append((event_type, data, subject, correlation_id))

    monkeypatch.setattr(publisher, "publish", fake_publish)
    return events


# ---------- process_with_retries ----------

def test_exito_al_primer_intento(monkeypatch):
    process, calls = fake_process(READY)
    monkeypatch.setattr(worker, "process_song", process)

    assert asyncio.run(worker.process_with_retries(DATA)) == ("audio.ready.v1", READY)
    assert len(calls) == 1


def test_error_temporal_se_reintenta_y_despues_sale_bien(monkeypatch):
    process, calls = fake_process(ProcessingError("STORAGE_ERROR", "MinIO no responde", retryable=True), READY)
    monkeypatch.setattr(worker, "process_song", process)

    assert asyncio.run(worker.process_with_retries(DATA)) == ("audio.ready.v1", READY)
    assert len(calls) == 2


def test_error_definitivo_no_se_reintenta(monkeypatch):
    process, calls = fake_process(ProcessingError("CORRUPT_FILE", "no se pudo leer"))
    monkeypatch.setattr(worker, "process_song", process)

    event_type, data = asyncio.run(worker.process_with_retries(DATA))

    assert event_type == "audio.failed.v1"
    assert data == {"song_id": SONG, "error_code": "CORRUPT_FILE", "error_message": "no se pudo leer",
                    "attempts": 1, "retryable": False}
    assert len(calls) == 1


def test_error_temporal_que_no_se_arregla_falla_al_ultimo_intento(monkeypatch):
    error = ProcessingError("STORAGE_ERROR", "MinIO no responde", retryable=True)
    process, calls = fake_process(*[error] * settings.max_attempts)
    monkeypatch.setattr(worker, "process_song", process)

    event_type, data = asyncio.run(worker.process_with_retries(DATA))

    assert event_type == "audio.failed.v1"
    assert data["attempts"] == settings.max_attempts
    assert data["retryable"] is True
    assert len(calls) == settings.max_attempts


def test_error_inesperado_falla_sin_reintento(monkeypatch):
    process, calls = fake_process(RuntimeError("bug"))
    monkeypatch.setattr(worker, "process_song", process)

    event_type, data = asyncio.run(worker.process_with_retries(DATA))

    assert (event_type, data["error_code"], len(calls)) == ("audio.failed.v1", "TRANSCODE_ERROR", 1)


def test_el_mensaje_de_error_se_recorta_a_1000_caracteres(monkeypatch):
    process, _ = fake_process(ProcessingError("TRANSCODE_ERROR", "x" * 5000))
    monkeypatch.setattr(worker, "process_song", process)

    _, data = asyncio.run(worker.process_with_retries(DATA))
    assert len(data["error_message"]) == 1000


# ---------- on_message ----------

def uploaded(event_id=None):
    return {"id": event_id or str(uuid.uuid4()), "type": "audio.uploaded.v1",
            "correlationid": "req-test", "data": DATA}


def on_message(body):
    message = FakeMessage(body)
    asyncio.run(worker.on_message(message))
    return message.result


def test_procesa_publica_el_resultado_y_confirma(monkeypatch, published):
    process, _ = fake_process(READY)
    monkeypatch.setattr(worker, "process_song", process)

    assert on_message(uploaded()) == "ack"
    assert published == [("audio.ready.v1", READY, f"song/{SONG}", "req-test")]


def test_evento_repetido_no_se_procesa_dos_veces(monkeypatch, published):
    process, calls = fake_process(READY)
    monkeypatch.setattr(worker, "process_song", process)
    event = uploaded()

    assert on_message(event) == "ack"
    assert on_message(event) == "ack"

    assert len(calls) == 1
    assert len(published) == 1


def test_mensaje_invalido_va_a_dead_letter(monkeypatch, published):
    process, calls = fake_process()
    monkeypatch.setattr(worker, "process_song", process)

    assert on_message(b"no es json") == "reject(requeue=False)"
    assert on_message({"id": "1", "data": {"song_id": SONG}}) == "reject(requeue=False)"  # sin original_key
    assert calls == []
    assert published == []


def test_si_no_se_puede_publicar_vuelve_a_la_cola_y_se_reintenta(monkeypatch):
    process, calls = fake_process(READY, READY)
    monkeypatch.setattr(worker, "process_song", process)

    async def failing_publish(*args):
        raise ConnectionError("RabbitMQ caído")

    monkeypatch.setattr(publisher, "publish", failing_publish)
    event = uploaded()
    assert on_message(event) == "nack(requeue=True)"

    # No quedó marcado como hecho: cuando vuelve, se procesa de nuevo.
    published = []

    async def ok_publish(*args):
        published.append(args)

    monkeypatch.setattr(publisher, "publish", ok_publish)
    assert on_message(event) == "ack"
    assert len(calls) == 2
    assert len(published) == 1


def test_build_event_sigue_el_formato_cloudevents():
    event = publisher.build_event("audio.ready.v1", READY, f"song/{SONG}", "req-test")

    assert event["specversion"] == "1.0"
    assert event["type"] == "audio.ready.v1"
    assert event["source"] == "/services/worker-ingesta"
    assert event["subject"] == f"song/{SONG}"
    assert event["data"] == READY
    uuid.UUID(event["id"])
    assert event["time"].endswith("Z")
