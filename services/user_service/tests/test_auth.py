"""Registro y login: reglas de contraseña, email repetido y respuestas iguales."""
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.routers import auth as auth_router
from app.security import hash_password

GOOD = "clave-segura-1"


def register(client, email="ana@example.com", password=GOOD):
    return client.post("/register", json={"email": email, "password": password})


def test_registro_ok_devuelve_token_y_publica_evento(client, published):
    response = register(client)
    assert response.status_code == 201
    assert response.json()["access_token"]
    assert len(published) == 1


@pytest.mark.parametrize("password", ["", "1234567", "ñ" * 37])
def test_contrasena_corta_o_de_mas_de_72_bytes_422(client, password):
    # "ñ" son 2 bytes: 37 caracteres = 74 bytes, más de lo que bcrypt usa.
    assert register(client, password=password).status_code == 422


def test_email_repetido_409(client):
    assert register(client).status_code == 201
    assert register(client).status_code == 409


def test_registro_simultaneo_da_409_y_no_500(client, monkeypatch):
    # Simula la carrera: la consulta previa no ve al otro usuario y el commit
    # choca con el índice único del email.
    def failing_commit(self):
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))

    monkeypatch.setattr(Session, "commit", failing_commit)
    assert register(client).status_code == 409


def test_login_ok_y_mal(client):
    register(client)
    assert client.post("/login", json={"email": "ana@example.com", "password": GOOD}).status_code == 200
    wrong = client.post("/login", json={"email": "ana@example.com", "password": "otra-clave"})
    missing = client.post("/login", json={"email": "nadie@example.com", "password": GOOD})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()


def test_login_de_cuenta_vieja_con_clave_corta_sigue_andando(client, session_maker):
    with session_maker() as db:
        db.add(User(email="vieja@example.com", hashed_password=hash_password("123"), role="user"))
        db.commit()
    assert client.post("/login", json={"email": "vieja@example.com", "password": "123"}).status_code == 200


def test_email_inexistente_igual_calcula_bcrypt(client, monkeypatch):
    # Sin esto la respuesta sería mucho más rápida y delataría que el email no existe.
    calls = []
    real = auth_router.verify_password
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: calls.append(h) or real(p, h))
    client.post("/login", json={"email": "nadie@example.com", "password": GOOD})
    assert calls == [auth_router.DUMMY_HASH]


@pytest.mark.parametrize("password", ["12345678", "ñ" * 36])
def test_contrasena_en_los_limites_se_acepta(client, password):
    # 8 caracteres es el mínimo; 36 "ñ" son justo 72 bytes.
    assert register(client, password=password).status_code == 201


def test_login_con_contrasena_enorme_422_sin_calcular_bcrypt(client, monkeypatch):
    calls = []
    monkeypatch.setattr(auth_router, "verify_password", lambda p, h: calls.append(h) or False)
    response = client.post("/login", json={"email": "ana@example.com", "password": "x" * 1025})
    assert response.status_code == 422
    assert calls == []
