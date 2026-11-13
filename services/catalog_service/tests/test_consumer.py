"""Consumidor de audio.ready.v1 / audio.failed.v1: estados, idempotencia y mensajes inválidos."""
import asyncio
import json
import uuid

import pytest

from app import consumer
from app.consumer import apply_event
from app.models import ProcessedEvent, Song, SongStatus

from .conftest import USER_ID

RENDITIONS = [
    {"processed_key": "processed/x/128.mp3", "codec": "mp3", "bitrate_kbps": 128, "size_bytes": 100},
    {"processed_key": "processed/x/320.mp3", "codec": "mp3", "bitrate_kbps": 320, "size_bytes": 250},
]
READY = {"duration_sec": 187.4, "renditions": RENDITIONS}
FAILED = {"error_code": "CORRUPT_FILE", "error_message": "no se pudo leer", "attempts": 1, "retryable": False}


class FakeMessage:
    """Imita un mensaje de aio-pika y anota qué se hizo con él."""

    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.result = None

    async def ack(self):
        self.result = "ack"

    async def reject(self, requeue=False):
        self.result = f"reject(requeue={requeue})"

    async def nack(self, requeue=True):
        self.result = f"nack(requeue={requeue})"


def event(event_type, song_id, data, event_id=None):
    return {
        "id": event_id or str(uuid.uuid4()),
        "type": event_type,
        "data": {"song_id": str(song_id), **data},
    }


# ---------- apply_event: función pura, sin base de datos ----------

def borrador():
    return Song(title="t", artist_id=USER_ID, status=SongStatus.BORRADOR)


def test_ready_publica_la_cancion_con_la_mejor_version():
    song = borrador()
    assert apply_event(song, "audio.ready.v1", READY) is True
    assert song.status == SongStatus.PUBLICADO
    assert song.duration == 187.4
    assert song.file_uri.endswith("processed/x/320.mp3")
    assert song.renditions == RENDITIONS


def test_ready_despues_de_un_fallo_limpia_el_error():
    song = borrador()
    apply_event(song, "audio.failed.v1", FAILED)
    apply_event(song, "audio.ready.v1", READY)
    assert song.status == SongStatus.PUBLICADO
    assert song.error_code is None
    assert song.error_message is None


def test_failed_marca_fallido_con_el_motivo():
    song = borrador()
    assert apply_event(song, "audio.failed.v1", FAILED) is True
    assert song.status == SongStatus.FALLIDO
    assert song.error_code == "CORRUPT_FILE"


def test_un_fallo_tardio_no_despublica():
    song = borrador()
    apply_event(song, "audio.ready.v1", READY)
    assert apply_event(song, "audio.failed.v1", FAILED) is False
    assert song.status == SongStatus.PUBLICADO


def test_tipo_desconocido_no_cambia_nada():
    song = borrador()
    assert apply_event(song, "audio.otra_cosa.v1", {}) is False
    assert song.status == SongStatus.BORRADOR


def test_ready_sin_renditions_es_un_error():
    with pytest.raises(KeyError):
        apply_event(borrador(), "audio.ready.v1", {"duration_sec": 1})


# ---------- handle: con base de datos (SQLite en memoria) ----------

@pytest.fixture
def song_id(client, run):
    """Canción en BORRADOR (el fixture client conecta el consumidor a la base de prueba)."""
    new_id = uuid.uuid4()

    async def seed(session):
        session.add(Song(id=new_id, title="t", artist_id=USER_ID, status=SongStatus.BORRADOR))
        await session.commit()

    run(seed)
    return new_id


def handle(body):
    message = FakeMessage(body)
    asyncio.run(consumer.handle(message))
    return message.result


def test_handle_ready_publica_y_confirma(song_id, run):
    assert handle(event("audio.ready.v1", song_id, READY)) == "ack"
    assert run(lambda s: s.get(Song, song_id)).status == SongStatus.PUBLICADO


def test_el_mismo_evento_dos_veces_se_aplica_una_sola(song_id, run):
    ready = event("audio.ready.v1", song_id, READY)
    assert handle(ready) == "ack"

    # Un fallo con el MISMO id (reentrega) no debe tocar la canción.
    repeated = {**event("audio.failed.v1", song_id, FAILED), "id": ready["id"]}
    assert handle(repeated) == "ack"

    assert run(lambda s: s.get(Song, song_id)).status == SongStatus.PUBLICADO
    assert run(lambda s: s.get(ProcessedEvent, ready["id"])) is not None


def test_handle_failed_marca_fallido(song_id, run):
    assert handle(event("audio.failed.v1", song_id, FAILED)) == "ack"
    song = run(lambda s: s.get(Song, song_id))
    assert song.status == SongStatus.FALLIDO
    assert song.error_message == "no se pudo leer"


def test_mensajes_invalidos_van_a_dead_letter(song_id):
    descartado = "reject(requeue=False)"
    assert handle(b"esto no es json") == descartado
    assert handle({"type": "audio.ready.v1", "data": {}}) == descartado              # sin id
    assert handle(event("audio.uploaded.v1", song_id, {})) == descartado             # tipo que no consume
    assert handle(event("audio.ready.v1", "no-es-uuid", READY)) == descartado
    assert handle(event("audio.ready.v1", song_id, {"duration_sec": 1})) == descartado  # sin renditions


def test_cancion_inexistente_va_a_dead_letter(client, deleted_files):
    song_id = uuid.uuid4()
    assert handle(event("audio.ready.v1", song_id, READY)) == "reject(requeue=False)"
    assert deleted_files == [song_id]


def test_limpieza_tardia_fallida_reencola(client, monkeypatch):
    async def fail(_):
        raise ConnectionError("MinIO caído")

    async def no_sleep(_):
        pass

    monkeypatch.setattr(consumer.minio_client, "delete_song_files", fail)
    monkeypatch.setattr(consumer.asyncio, "sleep", no_sleep)
    assert handle(event("audio.ready.v1", uuid.uuid4(), READY)) == "nack(requeue=True)"


def test_si_la_base_falla_el_mensaje_vuelve_a_la_cola(client, monkeypatch):
    def broken_session():
        raise ConnectionError("Postgres caído")

    async def no_sleep(_):
        pass

    monkeypatch.setattr(consumer, "SessionLocal", broken_session)
    monkeypatch.setattr(consumer.asyncio, "sleep", no_sleep)
    assert handle(event("audio.ready.v1", uuid.uuid4(), READY)) == "nack(requeue=True)"
