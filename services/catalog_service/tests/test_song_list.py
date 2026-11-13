"""GET /songs: paginación, orden, búsqueda e ids. user.deleted.v1 borra todo lo del usuario."""
import uuid

from app.models import Artist, Playlist, PlaylistSong, Song, SongStatus

from .conftest import USER_ID
from .test_artists import registered
from .test_consumer import handle

OTRO = uuid.uuid4()


def seed(run, title, artist_id=USER_ID, duration=None, status=SongStatus.PUBLICADO):
    song_id = uuid.uuid4()

    async def go(session):
        session.add(Song(id=song_id, title=title, artist_id=artist_id, status=status, duration=duration))
        await session.commit()

    run(go)
    return song_id


def titles(response):
    return [s["title"] for s in response.json()]


def test_pagina_con_limit_offset_y_total_en_header(client, run):
    for i in range(5):
        seed(run, f"Tema {i}")
    first = client.get("/songs", params={"limit": 2})
    assert titles(first) == ["Tema 0", "Tema 1"]
    assert first.headers["X-Total-Count"] == "5"
    assert titles(client.get("/songs", params={"limit": 2, "offset": 4})) == ["Tema 4"]
    assert client.get("/songs", params={"limit": 2, "offset": 10}).json() == []


def test_limite_por_defecto_y_maximo(client, run):
    for i in range(55):
        seed(run, f"T{i:02d}")
    response = client.get("/songs")
    assert len(response.json()) == 50
    assert response.headers["X-Total-Count"] == "55"
    assert client.get("/songs", params={"limit": 201}).status_code == 422
    assert client.get("/songs", params={"limit": 0}).status_code == 422
    assert client.get("/songs", params={"offset": -1}).status_code == 422


def test_ordenes(client, run):
    handle(registered(display_name="Zoe"))
    handle(registered(user_id=OTRO, display_name="Ana"))
    seed(run, "beta", duration=100)
    seed(run, "Alfa", artist_id=OTRO, duration=300)
    seed(run, "gamma")
    assert titles(client.get("/songs")) == ["Alfa", "beta", "gamma"]
    assert titles(client.get("/songs", params={"sort": "artist"})) == ["Alfa", "beta", "gamma"]
    assert titles(client.get("/songs", params={"sort": "longest"})) == ["Alfa", "beta", "gamma"]
    assert titles(client.get("/songs", params={"sort": "shortest"})) == ["beta", "Alfa", "gamma"]
    assert len(client.get("/songs", params={"sort": "newest"}).json()) == 3
    assert client.get("/songs", params={"sort": "otro"}).status_code == 422


def test_busqueda_por_titulo_o_artista(client, run):
    handle(registered(display_name="Los Teros"))
    seed(run, "Canción del río")
    seed(run, "Otra", artist_id=OTRO)
    seed(run, "100% real", artist_id=OTRO)
    assert titles(client.get("/songs", params={"q": "DEL R"})) == ["Canción del río"]
    assert titles(client.get("/songs", params={"q": "teros"})) == ["Canción del río"]
    assert titles(client.get("/songs", params={"q": "%"})) == ["100% real"]
    response = client.get("/songs", params={"q": "o", "limit": 1})
    assert response.headers["X-Total-Count"] == "2"


def test_ids_y_combinacion_con_artista(client, run):
    a = seed(run, "A")
    b = seed(run, "B", artist_id=OTRO)
    seed(run, "C")
    borrador = seed(run, "D", status=SongStatus.BORRADOR)
    ids = f"{a},{b},{borrador}"
    assert titles(client.get("/songs", params={"ids": ids})) == ["A", "B"]
    assert titles(client.get("/songs", params={"ids": ids, "artist_id": str(OTRO)})) == ["B"]
    assert client.get("/songs", params={"ids": "no-es-uuid"}).status_code == 422
    muchos = ",".join(str(uuid.uuid4()) for _ in range(101))
    assert client.get("/songs", params={"ids": muchos}).status_code == 422


def test_el_listado_no_expone_archivos(client, run):
    seed(run, "A")
    [song] = client.get("/songs").json()
    assert "file_uri" not in song and "renditions" not in song


def user_deleted(user_id=USER_ID, event_id=None):
    return {
        "id": event_id or str(uuid.uuid4()),
        "type": "user.deleted.v1",
        "data": {"user_id": str(user_id), "deleted_at": "2026-11-13T18:05:00Z"},
    }


def test_cuenta_borrada_se_lleva_canciones_playlists_y_artista(client, run, published, deleted_files):
    handle(registered(display_name="Ana"))
    mia = seed(run, "Mía")
    ajena = seed(run, "Ajena", artist_id=OTRO)
    mia_id, ajena_id = mia, ajena
    playlist_mia, playlist_ajena = uuid.uuid4(), uuid.uuid4()

    async def playlists(session):
        session.add(Playlist(id=playlist_mia, owner_id=USER_ID, name="Mía"))
        session.add(Playlist(id=playlist_ajena, owner_id=OTRO, name="Del otro"))
        await session.flush()
        session.add(PlaylistSong(playlist_id=playlist_mia, song_id=ajena_id, position=0))
        session.add(PlaylistSong(playlist_id=playlist_ajena, song_id=mia_id, position=0))
        session.add(PlaylistSong(playlist_id=playlist_ajena, song_id=ajena_id, position=1))
        await session.commit()

    run(playlists)
    event = user_deleted()
    assert handle(event) == "ack"

    assert run(lambda s: s.get(Song, mia_id)) is None
    assert run(lambda s: s.get(Song, ajena_id)) is not None
    assert run(lambda s: s.get(Artist, USER_ID)) is None
    assert run(lambda s: s.get(Playlist, playlist_mia)) is None
    assert run(lambda s: s.get(Playlist, playlist_ajena)) is not None
    assert run(lambda s: s.get(PlaylistSong, (playlist_ajena, mia_id))) is None
    assert run(lambda s: s.get(PlaylistSong, (playlist_ajena, ajena_id))) is not None
    assert deleted_files == [mia_id]
    assert [(e["type"], e["data"]["song_id"]) for e in published] == [("song.deleted.v1", str(mia_id))]

    # Repetido: no vuelve a publicar nada.
    assert handle(event) == "ack"
    assert len(published) == 1


def test_cuenta_borrada_reintenta_si_minio_falla(client, run, monkeypatch):
    from app import consumer

    song_id = seed(run, "Mía")

    async def fail(_):
        raise OSError("minio caído")

    async def no_sleep(_):
        pass

    monkeypatch.setattr(consumer.minio_client, "delete_song_files", fail)
    monkeypatch.setattr(consumer.asyncio, "sleep", no_sleep)
    assert handle(user_deleted()) == "nack(requeue=True)"
    assert run(lambda s: s.get(Song, song_id)) is not None
