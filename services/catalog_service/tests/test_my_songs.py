import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import minio_client
from app.config import settings
from app.models import Song, SongStatus
from .conftest import USER_ID

AUTH = {"X-User-Id": str(USER_ID)}


def seed_song(run, status=SongStatus.BORRADOR, owner=USER_ID):
    song_id = uuid.uuid4()

    async def seed(session):
        session.add(Song(id=song_id, title="Tema", artist_id=owner, status=status,
                         error_message="Error" if status == SongStatus.FALLIDO else None))
        await session.commit()

    run(seed)
    return song_id


def test_mine_returns_only_owner_in_all_states(client, run):
    ids = {str(seed_song(run, status)) for status in SongStatus}
    seed_song(run, owner=uuid.uuid4())
    response = client.get("/songs/mine", headers=AUTH)
    assert response.status_code == 200
    assert {s["id"] for s in response.json()} == ids
    assert {s["status"] for s in response.json()} == {s.value for s in SongStatus}
    assert next(s for s in response.json() if s["status"] == "FALLIDO")["error_message"] == "Error"


def test_mine_empty_and_authentication(client):
    assert client.get("/songs/mine", headers=AUTH).json() == []
    for headers in ({}, {"X-User-Id": "invalid"}):
        assert client.get("/songs/mine", headers=headers).status_code == 401
        assert client.delete(f"/songs/{uuid.uuid4()}", headers=headers).status_code == 401


@pytest.mark.parametrize("status", list(SongStatus))
def test_delete_owner_song(client, run, deleted_files, status):
    song_id = seed_song(run, status)
    response = client.delete(f"/songs/{song_id}", headers=AUTH)
    assert response.status_code == 204
    assert response.content == b""
    assert deleted_files == [song_id]
    assert run(lambda s: s.get(Song, song_id)) is None
    assert client.delete(f"/songs/{song_id}", headers=AUTH).status_code == 404


def test_delete_other_users_song_is_forbidden(client, run, deleted_files):
    song_id = seed_song(run, owner=uuid.uuid4())
    assert client.delete(f"/songs/{song_id}", headers=AUTH).status_code == 403
    assert deleted_files == []
    assert run(lambda s: s.get(Song, song_id)) is not None


def test_storage_failure_keeps_song_for_retry(client, run, monkeypatch):
    song_id = seed_song(run)

    async def fail(_):
        raise ConnectionError("MinIO offline")

    monkeypatch.setattr(minio_client, "delete_song_files", fail)
    assert client.delete(f"/songs/{song_id}", headers=AUTH).status_code == 503
    assert run(lambda s: s.get(Song, song_id)) is not None


def test_minio_deletes_originals_and_entire_processed_folder(monkeypatch):
    song_id = uuid.uuid4()
    prefix = f"{settings.processed_prefix}{song_id}/"
    keys = [prefix + name for name in ("128.mp3", "320.mp3", "waveform.json")]
    storage = Mock()
    storage.list_objects.return_value = [SimpleNamespace(object_name=key) for key in keys]
    monkeypatch.setattr(minio_client, "client", storage)
    asyncio.run(minio_client.delete_song_files(song_id))
    storage.list_objects.assert_called_once_with(settings.minio_bucket, prefix=prefix, recursive=True)
    assert [call.args for call in storage.remove_object.call_args_list] == [
        (settings.minio_bucket, key) for key in
        [f"{settings.raw_prefix}{song_id}.wav", f"{settings.raw_prefix}{song_id}.mp3", *keys]
    ]


def test_delete_publishes_song_deleted(client, run, deleted_files, published):
    song_id = seed_song(run, SongStatus.PUBLICADO)
    response = client.delete(f"/songs/{song_id}", headers={**AUTH, "X-Correlation-Id": "req-del"})
    assert response.status_code == 204
    assert published == [{
        "type": "song.deleted.v1",
        "data": {"song_id": str(song_id), "artist_id": str(USER_ID),
                 "deleted_by": str(USER_ID), "title": "Tema"},
        "subject": f"song/{song_id}",
        "correlation_id": "req-del",
    }]


def test_no_event_when_delete_is_rejected(client, run, deleted_files, published, monkeypatch):
    other = seed_song(run, owner=uuid.uuid4())
    assert client.delete(f"/songs/{other}", headers=AUTH).status_code == 403

    async def fail(_):
        raise ConnectionError("MinIO offline")

    monkeypatch.setattr(minio_client, "delete_song_files", fail)
    mine = seed_song(run)
    assert client.delete(f"/songs/{mine}", headers=AUTH).status_code == 503
    assert published == []


def test_broker_failure_after_delete_still_204(client, run, deleted_files, monkeypatch):
    from app import publisher

    async def fail(*args, **kwargs):
        raise ConnectionError("RabbitMQ offline")

    monkeypatch.setattr(publisher, "publish", fail)
    song_id = seed_song(run, SongStatus.PUBLICADO)
    assert client.delete(f"/songs/{song_id}", headers=AUTH).status_code == 204
    assert run(lambda s: s.get(Song, song_id)) is None
