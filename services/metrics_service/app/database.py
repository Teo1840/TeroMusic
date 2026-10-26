import os
from uuid import uuid4

import asyncpg

from app.models import SongPlayed


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
"""


async def open_pool():
    return await asyncpg.create_pool(
        host=os.getenv("POSTGRES_HOST", "postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        database=os.environ["POSTGRES_DB"],
        min_size=1, max_size=5, timeout=10, command_timeout=10,
    )


async def record_play(pool, event: SongPlayed, message_id: str | None = None):
    event_id = event.event_id or message_id or str(uuid4())
    if len(event_id) > 128:
        raise ValueError("message_id exceeds 128 characters")
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
