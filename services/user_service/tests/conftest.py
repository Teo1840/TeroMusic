"""Tests sin Postgres ni RabbitMQ: SQLite en memoria y el publish de eventos simulado.

Se arma una app solo con los routers (app.main corre ALTER TABLE de Postgres al importarse).
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET_KEY", "secreto-de-test")

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.routers import auth as auth_router  # noqa: E402


@pytest.fixture
def session_maker():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False)


@pytest.fixture
def published(monkeypatch):
    events = []
    monkeypatch.setattr(auth_router, "publish", lambda *args, **kwargs: events.append(args))
    return events


@pytest.fixture
def client(session_maker, published):
    app = FastAPI()
    app.include_router(auth_router.router)

    def override():
        db = session_maker()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    return TestClient(app)
