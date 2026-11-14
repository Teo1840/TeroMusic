import asyncio
import json
import os
from datetime import datetime
from uuid import UUID
import asyncpg

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE TABLE IF NOT EXISTS notifications.events (
    event_id UUID PRIMARY KEY,
    type TEXT NOT NULL,
    song_id UUID,
    payload JSONB NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_events_song ON notifications.events(song_id);
CREATE TABLE IF NOT EXISTS notifications.uploads (
    song_id UUID PRIMARY KEY,
    user_id UUID NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications.history (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    resource_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_user_history ON notifications.history(user_id, created_at DESC, id DESC);
-- NULL = sin leer. Las bases creadas antes reciben la columna acá.
ALTER TABLE notifications.history ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS notification_user_unread ON notifications.history(user_id) WHERE read_at IS NULL;
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



async def forget_user(pool, user_id: UUID):
    """user.deleted.v1: borra los avisos del usuario y quién subió cada canción.
    Repetirlo no cambia nada."""
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute("DELETE FROM notifications.history WHERE user_id=$1", user_id)
            await connection.execute("DELETE FROM notifications.uploads WHERE user_id=$1", user_id)


async def notify_song_removed(pool, event):
    """song.deleted.v1: si la borró un admin (deleted_by distinto del dueño), avisa al
    artista. Si la borró él mismo, o se borró junto con su cuenta, no hay nada que avisar.
    Repetir el evento no duplica el aviso (event_id único en history)."""
    data = event["data"]
    artist, deleted_by = UUID(data["artist_id"]), UUID(data["deleted_by"])
    if artist == deleted_by:
        return
    event_id, song_id = UUID(event["id"]), UUID(data["song_id"])
    timestamp = datetime.fromisoformat(event["time"].replace("Z", "+00:00"))
    title = data.get("title")
    message = (f"Un administrador borró tu canción «{title}»." if title
               else "Un administrador borró una de tus canciones.")
    async with pool.acquire() as connection:
        async with connection.transaction():
            await connection.execute(
                """INSERT INTO notifications.events(event_id,type,song_id,payload,occurred_at)
                VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING""",
                event_id, event["type"], song_id, json.dumps(data), timestamp)
            await connection.execute(
                """INSERT INTO notifications.history(event_id,user_id,type,message,resource_id,created_at)
                VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""",
                event_id, artist, event["type"], message, song_id, timestamp)


async def record_event(pool, event):
    kind, data = event["type"], event["data"]
    if kind == "user.deleted.v1":
        await forget_user(pool, UUID(data["user_id"]))
        return
    if kind == "song.deleted.v1":
        await notify_song_removed(pool, event)
        return
    event_id = UUID(event["id"])
    song_id = UUID(data["song_id"]) if "song_id" in data else None
    timestamp = datetime.fromisoformat(event["time"].replace("Z", "+00:00"))
    async with pool.acquire() as connection:
        async with connection.transaction():
            if song_id:
                # Serialize both sides of the join, including concurrent consumers.
                await connection.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", str(song_id))
            inserted = await connection.fetchval(
                """INSERT INTO notifications.events(event_id,type,song_id,payload,occurred_at)
                VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING event_id""",
                event_id, kind, song_id, json.dumps(data), timestamp)
            if inserted is None:
                return
            if song_id:
                if kind == "audio.uploaded.v1":
                    await connection.execute(
                        """INSERT INTO notifications.uploads(song_id,user_id) VALUES ($1,$2)
                        ON CONFLICT DO NOTHING""", song_id, UUID(data["uploaded_by"]))
                # A result received before the upload stays persisted until its owner arrives.
                await connection.execute(
                    """INSERT INTO notifications.history(event_id,user_id,type,message,resource_id,created_at)
                    SELECT e.event_id,u.user_id,e.type,
                    CASE WHEN e.type='audio.ready.v1' THEN 'Tu audio está listo para reproducir.'
                    ELSE 'No se pudo procesar tu audio.' END,e.song_id,e.occurred_at
                    FROM notifications.events e JOIN notifications.uploads u USING(song_id)
                    WHERE e.song_id=$1 AND e.type IN ('audio.ready.v1','audio.failed.v1')
                    ON CONFLICT (event_id) DO NOTHING""", song_id)
            else:
                if kind == "user.registered.v1":
                    user_id, resource_id = UUID(data["user_id"]), UUID(data["user_id"])
                    message = f"¡Bienvenido a TeroMusic, {data.get('display_name') or data['username']}!"
                else:
                    user_id, resource_id = UUID(data["host_id"]), UUID(data["room_id"])
                    message = f"Tu sala {data['name']} fue creada."
                await connection.execute(
                    """INSERT INTO notifications.history(event_id,user_id,type,message,resource_id,created_at)
                    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""",
                    event_id,user_id,kind,message,resource_id,timestamp)
