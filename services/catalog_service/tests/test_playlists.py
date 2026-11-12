"""Playlists: CRUD, dueño (403), canciones repetidas (409) y reordenar."""
import uuid

import pytest

from app.models import Song, SongStatus

from .conftest import USER_ID

AUTH = {"X-User-Id": str(USER_ID)}
OTHER = {"X-User-Id": str(uuid.uuid4())}


@pytest.fixture
def songs(run):
    """Tres canciones publicadas y una en BORRADOR. Devuelve sus ids."""
    ids = {name: uuid.uuid4() for name in ("a", "b", "c", "borrador")}

    async def seed(session):
        for name, song_id in ids.items():
            status = SongStatus.BORRADOR if name == "borrador" else SongStatus.PUBLICADO
            session.add(Song(id=song_id, title=f"Tema {name}", artist_id=USER_ID, status=status, duration=60.0))
        await session.commit()

    run(seed)
    return ids


def create(client, name="Para correr", headers=AUTH):
    return client.post("/playlists", json={"name": name}, headers=headers)


def add(client, playlist_id, song_id, headers=AUTH):
    return client.post(f"/playlists/{playlist_id}/songs", json={"song_id": str(song_id)}, headers=headers)


def song_titles(client, playlist_id):
    return [s["title"] for s in client.get(f"/playlists/{playlist_id}", headers=AUTH).json()["songs"]]


def test_crear_y_listar_solo_las_propias(client):
    response = create(client, name="  Para correr  ")
    assert response.status_code == 201
    assert response.json()["name"] == "Para correr"
    assert response.json()["song_count"] == 0

    create(client, name="De otro", headers=OTHER)

    mine = client.get("/playlists", headers=AUTH).json()
    assert [p["name"] for p in mine] == ["Para correr"]


def test_nombre_vacio_o_largo_422(client):
    assert create(client, name="   ").status_code == 422
    assert create(client, name="x" * 101).status_code == 422


def test_sin_usuario_401(client):
    assert client.get("/playlists").status_code == 401
    assert client.post("/playlists", json={"name": "x"}).status_code == 401


def test_agregar_canciones_en_orden_y_contarlas(client, songs):
    playlist_id = create(client).json()["id"]

    assert add(client, playlist_id, songs["a"]).status_code == 201
    assert add(client, playlist_id, songs["b"]).status_code == 201

    detail = client.get(f"/playlists/{playlist_id}", headers=AUTH).json()
    assert [s["title"] for s in detail["songs"]] == ["Tema a", "Tema b"]
    assert detail["songs"][0] == {"id": str(songs["a"]), "title": "Tema a", "duration": 60.0, "status": "PUBLICADO"}
    assert client.get("/playlists", headers=AUTH).json()[0]["song_count"] == 2


def test_cancion_repetida_409(client, songs):
    playlist_id = create(client).json()["id"]
    add(client, playlist_id, songs["a"])

    assert add(client, playlist_id, songs["a"]).status_code == 409


def test_cancion_inexistente_o_sin_publicar_404(client, songs):
    playlist_id = create(client).json()["id"]

    assert add(client, playlist_id, uuid.uuid4()).status_code == 404
    assert add(client, playlist_id, songs["borrador"]).status_code == 404


def test_sacar_cancion(client, songs):
    playlist_id = create(client).json()["id"]
    add(client, playlist_id, songs["a"])
    add(client, playlist_id, songs["b"])

    response = client.delete(f"/playlists/{playlist_id}/songs/{songs['a']}", headers=AUTH)
    assert response.status_code == 204
    assert song_titles(client, playlist_id) == ["Tema b"]

    # Ya no está: 404.
    assert client.delete(f"/playlists/{playlist_id}/songs/{songs['a']}", headers=AUTH).status_code == 404


def test_reordenar(client, songs):
    playlist_id = create(client).json()["id"]
    for name in ("a", "b", "c"):
        add(client, playlist_id, songs[name])

    new_order = [str(songs["c"]), str(songs["a"]), str(songs["b"])]
    response = client.put(f"/playlists/{playlist_id}/songs", json={"song_ids": new_order}, headers=AUTH)

    assert response.status_code == 200
    assert song_titles(client, playlist_id) == ["Tema c", "Tema a", "Tema b"]

    # Después de reordenar, una canción nueva va al final.
    add(client, playlist_id, songs["borrador"])  # 404, no cambia nada
    client.delete(f"/playlists/{playlist_id}/songs/{songs['b']}", headers=AUTH)
    add(client, playlist_id, songs["b"])
    assert song_titles(client, playlist_id) == ["Tema c", "Tema a", "Tema b"]


@pytest.mark.parametrize("ids", [
    ["a", "b"],            # falta una
    ["a", "b", "b"],       # repetida
    ["a", "b", "borrador"],  # una que no está
])
def test_reordenar_con_canciones_distintas_400(client, songs, ids):
    playlist_id = create(client).json()["id"]
    for name in ("a", "b", "c"):
        add(client, playlist_id, songs[name])

    response = client.put(
        f"/playlists/{playlist_id}/songs",
        json={"song_ids": [str(songs[n]) for n in ids]},
        headers=AUTH,
    )
    assert response.status_code == 400
    assert song_titles(client, playlist_id) == ["Tema a", "Tema b", "Tema c"]


def test_renombrar(client):
    playlist_id = create(client).json()["id"]

    response = client.patch(f"/playlists/{playlist_id}", json={"name": "Domingo"}, headers=AUTH)
    assert response.status_code == 200
    assert client.get(f"/playlists/{playlist_id}", headers=AUTH).json()["name"] == "Domingo"


def test_borrar_playlist(client, songs):
    playlist_id = create(client).json()["id"]
    add(client, playlist_id, songs["a"])

    assert client.delete(f"/playlists/{playlist_id}", headers=AUTH).status_code == 204
    assert client.get(f"/playlists/{playlist_id}", headers=AUTH).status_code == 404
    assert client.get("/playlists", headers=AUTH).json() == []


def test_playlist_inexistente_404(client):
    missing = uuid.uuid4()
    assert client.get(f"/playlists/{missing}", headers=AUTH).status_code == 404
    assert client.delete(f"/playlists/{missing}", headers=AUTH).status_code == 404


def test_playlist_de_otro_usuario_403(client, songs):
    playlist_id = create(client).json()["id"]

    assert client.get(f"/playlists/{playlist_id}", headers=OTHER).status_code == 403
    assert client.patch(f"/playlists/{playlist_id}", json={"name": "x"}, headers=OTHER).status_code == 403
    assert client.delete(f"/playlists/{playlist_id}", headers=OTHER).status_code == 403
    assert add(client, playlist_id, songs["a"], headers=OTHER).status_code == 403
    assert client.put(f"/playlists/{playlist_id}/songs", json={"song_ids": []}, headers=OTHER).status_code == 403
    assert client.delete(f"/playlists/{playlist_id}/songs/{songs['a']}", headers=OTHER).status_code == 403
