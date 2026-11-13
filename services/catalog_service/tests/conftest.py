"""Fixtures: base SQLite en memoria en lugar de Postgres, y MinIO / RabbitMQ simulados.

Así los tests corren sin Docker ni servicios levantados.
"""
import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import consumer, main, minio_client, publisher
from app.database import Base, get_session

USER_ID = uuid.UUID("5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60")


@pytest.fixture
def session_maker():
    # StaticPool: todas las sesiones comparten la misma base en memoria.
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    async def create():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create())
    yield async_sessionmaker(engine, expire_on_commit=False)
    asyncio.run(engine.dispose())


@pytest.fixture
def run(session_maker):
    """Corre una corrutina que recibe una sesión: run(lambda s: s.get(...))."""

    def _run(fn):
        async def go():
            async with session_maker() as session:
                return await fn(session)

        return asyncio.run(go())

    return _run


@pytest.fixture
def uploads(monkeypatch):
    """MinIO simulado: guarda (key, bytes, content_type) de cada subida."""
    saved = []

    async def fake_upload(key, fileobj, size, content_type):
        saved.append((key, fileobj.read(), content_type))

    monkeypatch.setattr(minio_client, "upload_fileobj", fake_upload)
    return saved


@pytest.fixture
def published(monkeypatch):
    """RabbitMQ simulado: guarda cada evento publicado."""
    events = []

    async def fake_publish(event_type, data, subject, correlation_id):
        events.append({"type": event_type, "data": data, "subject": subject, "correlation_id": correlation_id})

    monkeypatch.setattr(publisher, "publish", fake_publish)
    return events


@pytest.fixture
def deleted_files(monkeypatch):
    deleted = []

    async def fake_delete(song_id):
        deleted.append(song_id)

    monkeypatch.setattr(minio_client, "delete_song_files", fake_delete)
    return deleted


@pytest.fixture
def client(session_maker, uploads, published, deleted_files, monkeypatch):
    """API sin lifespan (no conecta a Postgres, MinIO ni RabbitMQ)."""

    async def override_session():
        async with session_maker() as session:
            yield session

    main.app.dependency_overrides[get_session] = override_session
    # El consumidor abre sus propias sesiones: que use la misma base.
    monkeypatch.setattr(consumer, "SessionLocal", session_maker)
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()
