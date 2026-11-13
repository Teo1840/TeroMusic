import asyncio
import os

import asyncpg

from app.models import DomainEvent, SongDeleted, SongPlayed


SCHEMA = """
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.play_events (
    event_id VARCHAR(128) PRIMARY KEY,
    song_id VARCHAR(128) NOT NULL,
    user_id VARCHAR(128) NOT NULL,
    played_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS analytics.song_metrics (
    song_id VARCHAR(128) PRIMARY KEY,
    total_plays BIGINT NOT NULL DEFAULT 0 CHECK (total_plays >= 0)
);
-- user.registered.v1 y room.created.v1: un registro por evento (event_id descarta
-- repetidos). subject_id es el usuario o la sala.
CREATE TABLE IF NOT EXISTS analytics.domain_events (
    event_id VARCHAR(128) PRIMARY KEY,
    type VARCHAR(64) NOT NULL,
    subject_id VARCHAR(128) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS domain_events_type ON analytics.domain_events(type, subject_id);
"""

# Errores que se arreglan solos (la base se reinicia, se cortó la conexión, no hay
# conexiones libres): el mensaje vuelve a la cola. Cualquier otro error es del
# mensaje y reintentarlo daría lo mismo: va a la cola de errores (musicapp.dlq).
TRANSIENT_ERRORS = (
    OSError,  # incluye ConnectionError y TimeoutError (= asyncio.TimeoutError)
    asyncio.TimeoutError,
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    asyncpg.CannotConnectNowError,
    asyncpg.TooManyConnectionsError,
    asyncpg.TransactionRollbackError,  # deadlock o conflicto de serialización
)


def is_transient(error: BaseException) -> bool:
    return isinstance(error, TRANSIENT_ERRORS)


async def open_pool():
    return await asyncpg.create_pool(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        database=os.environ["POSTGRES_DB"],
        min_size=1, max_size=5, timeout=10, command_timeout=10,
    )


async def record_play(pool, event: SongPlayed):
    event_id = event.event_id
    async with pool.acquire() as connection:
        async with connection.transaction():
            inserted = await connection.fetchval(
                """INSERT INTO analytics.play_events(event_id, song_id, user_id, played_at)
                   VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING
                   RETURNING event_id""",
                event_id, event.song_id, event.user_id, event.timestamp,
            )
            if inserted is not None:
                await connection.execute(
                    """INSERT INTO analytics.song_metrics(song_id, total_plays)
                       VALUES ($1, 1) ON CONFLICT (song_id)
                       DO UPDATE SET total_plays = analytics.song_metrics.total_plays + 1""",
                    event.song_id,
                )


async def record_event(pool, event: DomainEvent):
    await pool.execute(
        """INSERT INTO analytics.domain_events(event_id, type, subject_id, occurred_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING""",
        event.event_id, event.type, event.subject_id, event.timestamp,
    )


async def forget_song(pool, event: SongDeleted):
    """La canción se borró del catálogo: deja de contar en el top y en los totales por
    canción. Las reproducciones quedan en play_events como historial. Repetirlo no cambia nada.

    Si después llega un song.played atrasado de esa canción, vuelve a crear su contador
    con 1: es una escucha que existió, y el front no muestra canciones que no están
    en el catálogo."""
    await pool.execute("DELETE FROM analytics.song_metrics WHERE song_id = $1", event.song_id)
