"""Nombre del artista: user.registered.v1 / user.profile_updated.v1 llenan la tabla
artists, y los listados devuelven artist_name."""
import uuid

from app.models import Artist, ProcessedEvent, Song, SongStatus

from .conftest import USER_ID
from .test_consumer import handle


def registered(user_id=USER_ID, display_name="Ana", event_id=None):
    return {
        "id": event_id or str(uuid.uuid4()),
        "type": "user.registered.v1",
        "data": {
            "user_id": str(user_id),
            "email": "ana@example.com",
            "username": "ana",
            "display_name": display_name,
        },
    }


def profile_updated(display_name, updated_at, user_id=USER_ID):
    return {
        "id": str(uuid.uuid4()),
        "type": "user.profile_updated.v1",
        "data": {
            "user_id": str(user_id),
            "username": "ana",
            "display_name": display_name,
            "updated_at": updated_at,
        },
    }


def artist(run, user_id=USER_ID):
    return run(lambda s: s.get(Artist, user_id))


def test_registro_crea_el_artista(client, run):
    assert handle(registered()) == "ack"
    assert artist(run).display_name == "Ana"


def test_registro_sin_display_name_usa_el_username(client, run):
    event = registered()
    del event["data"]["display_name"]
    assert handle(event) == "ack"
    assert artist(run).display_name == "ana"


def test_registro_repetido_se_aplica_una_vez(client, run):
    first = registered(display_name="Ana")
    assert handle(first) == "ack"
    assert handle({**registered(display_name="Otro"), "id": first["id"]}) == "ack"
    assert artist(run).display_name == "Ana"
    assert run(lambda s: s.get(ProcessedEvent, first["id"])) is not None


def test_cambio_de_perfil_actualiza_el_nombre(client, run):
    handle(registered())
    assert handle(profile_updated("Ana y los Teros", "2026-11-13T15:30:00Z")) == "ack"
    assert artist(run).display_name == "Ana y los Teros"


def test_cambio_de_perfil_viejo_no_pisa_uno_nuevo(client, run):
    handle(profile_updated("Nuevo", "2026-11-13T15:30:00Z"))
    assert handle(profile_updated("Viejo", "2026-11-13T15:00:00Z")) == "ack"
    assert artist(run).display_name == "Nuevo"


def test_registro_tardio_no_pisa_un_cambio_de_perfil(client, run):
    handle(profile_updated("Nuevo", "2026-11-13T15:30:00Z"))
    assert handle(registered(display_name="Del registro")) == "ack"
    assert artist(run).display_name == "Nuevo"


def test_eventos_de_usuario_invalidos_van_a_dead_letter(client):
    descartado = "reject(requeue=False)"
    sin_fecha = profile_updated("x", "2026-11-13T15:30:00Z")
    del sin_fecha["data"]["updated_at"]
    assert handle(sin_fecha) == descartado
    assert handle(registered(user_id="no-es-uuid")) == descartado
    sin_username = registered()
    del sin_username["data"]["username"]
    assert handle(sin_username) == descartado


def seed_song(run, artist_id=USER_ID, title="Tema"):
    song_id = uuid.uuid4()

    async def seed(session):
        session.add(Song(id=song_id, title=title, artist_id=artist_id, status=SongStatus.PUBLICADO))
        await session.commit()

    run(seed)
    return song_id


def test_listado_y_detalle_traen_el_nombre_del_artista(client, run):
    handle(registered(display_name="Ana"))
    song_id = seed_song(run)

    [song] = client.get("/songs").json()
    assert song["artist_name"] == "Ana"
    assert client.get(f"/songs/{song_id}").json()["artist_name"] == "Ana"


def test_artista_desconocido_sale_con_nombre_vacio(client, run):
    song_id = seed_song(run, artist_id=uuid.uuid4())
    [song] = client.get("/songs").json()
    assert song["artist_name"] is None
    assert client.get(f"/songs/{song_id}").json()["artist_name"] is None


def test_la_playlist_trae_el_nombre_del_artista(client, run):
    handle(registered(display_name="Ana"))
    song_id = seed_song(run)
    headers = {"X-User-Id": str(USER_ID)}
    playlist = client.post("/playlists", json={"name": "Mía"}, headers=headers).json()
    client.post(f"/playlists/{playlist['id']}/songs", json={"song_id": str(song_id)}, headers=headers)

    songs = client.get(f"/playlists/{playlist['id']}", headers=headers).json()["songs"]
    assert songs[0]["artist_name"] == "Ana"
