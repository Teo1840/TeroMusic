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
-- Series por día y tendencias: filtran play_events por fecha (y por canción).
CREATE INDEX IF NOT EXISTS play_events_played_at ON analytics.play_events(played_at);
CREATE INDEX IF NOT EXISTS play_events_song_played_at ON analytics.play_events(song_id, played_at);
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


# Reproducciones por día de los últimos `days` días (hoy incluido), contando los días
# en la zona horaria `tz` y con 0 en los días sin escuchas. $3 NULL = todas las canciones.
DAILY_SQL = """
WITH bounds AS (
    SELECT (NOW() AT TIME ZONE $1)::date AS today
), per_day AS (
    SELECT (p.played_at AT TIME ZONE $1)::date AS day, COUNT(*) AS plays
    FROM analytics.play_events p, bounds b
    WHERE p.played_at >= ((b.today - ($2::int - 1))::timestamp AT TIME ZONE $1)
      AND ($3::varchar[] IS NULL OR p.song_id = ANY($3::varchar[]))
    GROUP BY 1
)
SELECT g.day::date AS day, COALESCE(per_day.plays, 0) AS plays
FROM bounds b
CROSS JOIN generate_series((b.today - ($2::int - 1))::timestamp, b.today::timestamp, interval '1 day') AS g(day)
LEFT JOIN per_day ON per_day.day = g.day::date
ORDER BY g.day
"""


async def daily_plays(pool, days: int, tz: str, song_ids: list[str] | None = None):
    return await pool.fetch(DAILY_SQL, tz, days, song_ids)


# Ventana actual (últimos `days` días) contra la anterior del mismo largo. Solo
# canciones que siguen en el catálogo (song_metrics pierde las borradas).
TRENDING_SQL = """
WITH windows AS (
    SELECT NOW() - make_interval(days => $1) AS since,
           NOW() - make_interval(days => 2 * $1) AS before
), current_window AS (
    SELECT p.song_id, COUNT(*) AS plays
    FROM analytics.play_events p, windows w
    WHERE p.played_at >= w.since
    GROUP BY p.song_id
), previous_window AS (
    SELECT p.song_id, COUNT(*) AS plays
    FROM analytics.play_events p, windows w
    WHERE p.played_at >= w.before AND p.played_at < w.since
    GROUP BY p.song_id
)
SELECT c.song_id, c.plays, COALESCE(prev.plays, 0) AS previous_plays
FROM current_window c
JOIN analytics.song_metrics m ON m.song_id = c.song_id
LEFT JOIN previous_window prev ON prev.song_id = c.song_id
ORDER BY c.plays DESC, c.plays - COALESCE(prev.plays, 0) DESC, c.song_id
LIMIT $2
"""

WINDOW_TOTALS_SQL = """
SELECT
  COUNT(*) FILTER (WHERE played_at >= NOW() - make_interval(days => $1)) AS plays,
  COUNT(*) FILTER (WHERE played_at >= NOW() - make_interval(days => 2 * $1)
                     AND played_at < NOW() - make_interval(days => $1)) AS previous_plays
FROM analytics.play_events
WHERE played_at >= NOW() - make_interval(days => 2 * $1)
"""


async def trending(pool, days: int, limit: int):
    """(totales de las dos ventanas, filas por canción)."""
    totals = await pool.fetchrow(WINDOW_TOTALS_SQL, days)
    rows = await pool.fetch(TRENDING_SQL, days, limit)
    return totals, rows
