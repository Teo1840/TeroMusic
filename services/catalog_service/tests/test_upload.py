"""POST /songs/upload, GET /songs y GET /songs/{id}."""
import uuid

from app import publisher
from app.config import settings
from app.models import Song, SongStatus

from .conftest import USER_ID

AUTH = {"X-User-Id": str(USER_ID)}


def upload(client, name="cancion.wav", content=b"RIFF....WAVEdatos", title="Mi canción", headers=AUTH):
    return client.post(
        "/songs/upload",
        data={"title": title},
        files={"file": (name, content, "application/octet-stream")},
        headers=headers,
    )


def test_wav_responde_202_guarda_borrador_y_publica_el_evento(client, run, uploads, published):
    response = upload(client, headers={**AUTH, "X-Correlation-Id": "req-test"})

    assert response.status_code == 202
    song_id = uuid.UUID(response.json()["song_id"])
    assert response.json()["status"] == "BORRADOR"

    # El original va a raw/{id}.wav con su tipo.
    assert uploads == [(f"raw/{song_id}.wav", b"RIFF....WAVEdatos", "audio/wav")]

    song = run(lambda s: s.get(Song, song_id))
    assert song.status == SongStatus.BORRADOR
    assert song.title == "Mi canción"
    assert song.artist_id == USER_ID

    assert len(published) == 1
    event = published[0]
    assert event["type"] == "audio.uploaded.v1"
    assert event["subject"] == f"song/{song_id}"
    assert event["correlation_id"] == "req-test"
    assert event["data"]["uploaded_by"] == str(USER_ID)
    assert event["data"]["original_key"] == f"raw/{song_id}.wav"
    assert event["data"]["content_type"] == "audio/wav"
    assert event["data"]["size_bytes"] == len(b"RIFF....WAVEdatos")
    assert len(event["data"]["checksum_sha256"]) == 64


def test_mp3_se_acepta_con_su_tipo(client, uploads, published):
    response = upload(client, name="Tema.MP3", content=b"ID3datos")

    assert response.status_code == 202
    assert uploads[0][0].endswith(".mp3")
    assert uploads[0][2] == "audio/mpeg"
    assert published[0]["data"]["content_type"] == "audio/mpeg"


def test_el_artista_sale_del_gateway_no_del_formulario(client, run, published):
    otro = str(uuid.uuid4())
    response = client.post(
        "/songs/upload",
        data={"title": "x", "artist_id": otro},
        files={"file": ("a.wav", b"datos", "audio/wav")},
        headers=AUTH,
    )

    assert response.status_code == 202
    assert published[0]["data"]["uploaded_by"] == str(USER_ID)


def test_sin_usuario_o_con_usuario_invalido_401(client, uploads):
    assert upload(client, headers={}).status_code == 401
    assert upload(client, headers={"X-User-Id": "no-es-uuid"}).status_code == 401
    assert uploads == []


def test_formato_no_aceptado_400(client, uploads, published):
    for name in ("tema.flac", "tema.ogg", "tema", "tema.wav.exe"):
        assert upload(client, name=name).status_code == 400, name
    assert uploads == []
    assert published == []


def test_archivo_vacio_400(client, uploads):
    assert upload(client, content=b"").status_code == 400
    assert uploads == []


def test_archivo_demasiado_grande_413(client, uploads, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    assert upload(client).status_code == 413
    assert uploads == []


def test_si_rabbitmq_falla_responde_503(client, monkeypatch):
    async def failing_publish(*args, **kwargs):
        raise ConnectionError("RabbitMQ caído")

    monkeypatch.setattr(publisher, "publish", failing_publish)
    assert upload(client).status_code == 503


def test_lista_solo_las_publicadas(client, run):
    async def seed(session):
        for title, status in (("Lista", SongStatus.PUBLICADO), ("Procesando", SongStatus.BORRADOR),
                              ("Rota", SongStatus.FALLIDO)):
            session.add(Song(title=title, artist_id=USER_ID, status=status))
        await session.commit()

    run(seed)

    titles = [song["title"] for song in client.get("/songs").json()]
    assert titles == ["Lista"]


def test_detalle_de_una_cancion_y_404(client, run):
    song_id = uuid.uuid4()

    async def seed(session):
        session.add(Song(id=song_id, title="Rota", artist_id=USER_ID, status=SongStatus.FALLIDO,
                         error_code="CORRUPT_FILE", error_message="no se pudo leer"))
        await session.commit()

    run(seed)

    body = client.get(f"/songs/{song_id}").json()
    assert body["status"] == "FALLIDO"
    assert body["error_code"] == "CORRUPT_FILE"
    assert client.get(f"/songs/{uuid.uuid4()}").status_code == 404
