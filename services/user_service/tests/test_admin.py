"""Roles: admin por ADMIN_EMAILS, endpoints /admin y /verify leyendo el rol de la base."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import security
from app.database import get_db
from app.models import User
from app.routers import admin as admin_router
from app.routers import auth as auth_router

PASSWORD = "contrasena-segura"


@pytest.fixture
def api(session_maker, published, monkeypatch):
    monkeypatch.setattr(security, "ADMIN_EMAILS", {"jefa@tero.com"})
    app = FastAPI()
    app.include_router(auth_router.router)
    app.include_router(admin_router.router)

    def override():
        db = session_maker()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    return TestClient(app)


def register(api, email):
    token = api.post("/register", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def user_id(api, headers):
    return api.get("/verify", headers=headers).headers["x-user-id"]


def test_admin_emails_se_registran_como_admin_y_el_resto_como_user(api):
    jefa = register(api, "Jefa@tero.com")
    ana = register(api, "ana@tero.com")
    assert api.get("/verify", headers=jefa).headers["x-user-role"] == "admin"
    assert api.get("/verify", headers=ana).headers["x-user-role"] == "user"


def test_solo_admin_lista_usuarios(api):
    jefa = register(api, "jefa@tero.com")
    ana = register(api, "ana@tero.com")
    assert api.get("/admin/users", headers=ana).status_code == 403
    assert api.get("/admin/users").status_code in (401, 403)

    users = api.get("/admin/users", headers=jefa).json()
    assert {u["email"] for u in users} == {"jefa@tero.com", "ana@tero.com"}
    assert "hashed_password" not in users[0]
    found = api.get("/admin/users", params={"q": "ANA"}, headers=jefa).json()
    assert [u["email"] for u in found] == ["ana@tero.com"]
    # Los comodines de LIKE se buscan como texto.
    assert api.get("/admin/users", params={"q": "%"}, headers=jefa).json() == []


def test_cambiar_rol_vale_al_instante_sin_nuevo_login(api):
    jefa = register(api, "jefa@tero.com")
    ana = register(api, "ana@tero.com")
    ana_id = user_id(api, ana)

    response = api.patch(f"/admin/users/{ana_id}/role", json={"role": "admin"}, headers=jefa)
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    # El token de Ana dice "user", pero /verify lee la base.
    assert api.get("/verify", headers=ana).headers["x-user-role"] == "admin"
    assert api.get("/admin/users", headers=ana).status_code == 200


def test_rol_invalido_y_usuario_inexistente(api):
    jefa = register(api, "jefa@tero.com")
    ana_id = user_id(api, register(api, "ana@tero.com"))
    assert api.patch(f"/admin/users/{ana_id}/role", json={"role": "dios"}, headers=jefa).status_code == 422
    missing = "00000000-0000-4000-8000-000000000000"
    assert api.patch(f"/admin/users/{missing}/role", json={"role": "admin"}, headers=jefa).status_code == 404


def test_no_se_puede_quitar_el_ultimo_admin(api):
    jefa = register(api, "jefa@tero.com")
    jefa_id = user_id(api, jefa)
    response = api.patch(f"/admin/users/{jefa_id}/role", json={"role": "user"}, headers=jefa)
    assert response.status_code == 409

    ana = register(api, "ana@tero.com")
    api.patch(f"/admin/users/{user_id(api, ana)}/role", json={"role": "admin"}, headers=jefa)
    assert api.patch(f"/admin/users/{jefa_id}/role", json={"role": "user"}, headers=jefa).status_code == 200


def test_verify_rechaza_cuenta_borrada(api, session_maker):
    ana = register(api, "ana@tero.com")
    db = session_maker()
    db.query(User).delete()
    db.commit()
    db.close()
    assert api.get("/verify", headers=ana).status_code == 401
