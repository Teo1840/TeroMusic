"""Renovación de sesión, cambio de contraseña y baja de la cuenta."""
from datetime import datetime, timedelta, timezone

from jose import jwt

from app import security
from app.models import User

GOOD = "clave-segura-1"
NEW = "otra-clave-segura"


def register(client, email="ana@example.com", password=GOOD):
    return client.post("/register", json={"email": email, "password": password}).json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def claims(token):
    return jwt.decode(token, security.SECRET_KEY, algorithms=[security.ALGORITHM])


def test_refresh_da_un_token_nuevo_que_conserva_el_login(client):
    token = register(client)
    response = client.post("/refresh", headers=auth(token))
    assert response.status_code == 200
    nuevo = response.json()["access_token"]
    assert claims(nuevo)["sub"] == claims(token)["sub"]
    assert claims(nuevo)["auth_time"] == claims(token)["auth_time"]
    assert client.get("/verify", headers=auth(nuevo)).status_code == 200


def test_refresh_sin_token_o_vencido_401(client):
    assert client.post("/refresh").status_code in (401, 403)
    token = register(client)
    payload = claims(token)
    payload["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    vencido = jwt.encode(payload, security.SECRET_KEY, algorithm=security.ALGORITHM)
    assert client.post("/refresh", headers=auth(vencido)).status_code == 401


def test_refresh_no_estira_la_sesion_para_siempre(client):
    token = register(client)
    payload = claims(token)
    payload["auth_time"] -= security.SESSION_MAX_HOURS * 3600 + 1
    viejo = jwt.encode(payload, security.SECRET_KEY, algorithm=security.ALGORITHM)
    assert client.post("/refresh", headers=auth(viejo)).status_code == 401


def test_cambiar_contrasena_corta_las_otras_sesiones(client):
    token = register(client)
    response = client.post("/me/password", headers=auth(token),
                           json={"current_password": GOOD, "new_password": NEW})
    assert response.status_code == 200
    nuevo = response.json()["access_token"]

    assert client.get("/verify", headers=auth(token)).status_code == 401
    assert client.post("/refresh", headers=auth(token)).status_code == 401
    assert client.get("/verify", headers=auth(nuevo)).status_code == 200

    login = lambda p: client.post("/login", json={"email": "ana@example.com", "password": p})  # noqa: E731
    assert login(GOOD).status_code == 401
    assert login(NEW).status_code == 200


def test_cambiar_contrasena_con_la_actual_mal_403(client):
    token = register(client)
    response = client.post("/me/password", headers=auth(token),
                           json={"current_password": "no-es-esta", "new_password": NEW})
    assert response.status_code == 403
    assert client.get("/verify", headers=auth(token)).status_code == 200


def test_contrasena_nueva_corta_o_igual(client):
    token = register(client)
    corta = client.post("/me/password", headers=auth(token),
                        json={"current_password": GOOD, "new_password": "123"})
    igual = client.post("/me/password", headers=auth(token),
                        json={"current_password": GOOD, "new_password": GOOD})
    assert corta.status_code == 422
    assert igual.status_code == 400


def test_borrar_cuenta(client, published, session_maker):
    token = register(client)
    user_id = claims(token)["sub"]
    assert client.request("DELETE", "/me", headers=auth(token), json={"password": GOOD}).status_code == 204

    assert client.get("/verify", headers=auth(token)).status_code == 401
    assert client.get("/me", headers=auth(token)).status_code == 401
    assert client.post("/login", json={"email": "ana@example.com", "password": GOOD}).status_code == 401
    with session_maker() as db:
        assert db.query(User).count() == 0

    event_type, subject, data = published[-1][:3]
    assert event_type == "user.deleted.v1"
    assert str(subject) == user_id and data["user_id"] == user_id
    # El email queda libre para una cuenta nueva.
    assert client.post("/register", json={"email": "ana@example.com", "password": GOOD}).status_code == 201


def test_borrar_cuenta_con_contrasena_mal_no_borra(client, published):
    token = register(client)
    assert client.request("DELETE", "/me", headers=auth(token), json={"password": "nop"}).status_code == 403
    assert client.get("/verify", headers=auth(token)).status_code == 200
    assert all(event[0] != "user.deleted.v1" for event in published)


def test_token_viejo_sin_version_sigue_valiendo(client):
    # Tokens emitidos antes de token_version no traen "ver": valen mientras la clave no cambie.
    token = register(client)
    payload = claims(token)
    del payload["ver"]
    viejo = jwt.encode(payload, security.SECRET_KEY, algorithm=security.ALGORITHM)
    assert client.get("/verify", headers=auth(viejo)).status_code == 200
