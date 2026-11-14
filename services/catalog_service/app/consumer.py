"""Consumidor de la cola catalog.q.

- audio.ready.v1 / audio.failed.v1: resultado del worker sobre una canción.
- user.registered.v1 / user.profile_updated.v1: nombre del artista (tabla artists).
- user.deleted.v1: la cuenta se borró. Se van sus canciones (con sus archivos), sus
  playlists y su perfil de artista; por cada canción se publica song.deleted.v1.
"""
import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import aio_pika
from sqlalchemy import delete, select

from .config import settings
from . import minio_client, publisher
from .database import SessionLocal
from .models import Artist, Playlist, PlaylistSong, ProcessedEvent, Song, SongStatus

log = logging.getLogger("catalog.consumer")

QUEUE = "catalog.q"
SONG_EVENTS = ("audio.ready.v1", "audio.failed.v1")
USER_EVENTS = ("user.registered.v1", "user.profile_updated.v1")
USER_DELETED = "user.deleted.v1"
BINDINGS = SONG_EVENTS + USER_EVENTS + (USER_DELETED,)


def apply_event(song, event_type: str, data: dict) -> bool:
    """Aplica el resultado del worker a la canción. True si hubo cambios."""
    if event_type == "audio.ready.v1":
        renditions = data["renditions"]
        best = max(renditions, key=lambda r: r["bitrate_kbps"])
        song.status = SongStatus.PUBLICADO
        song.duration = data["duration_sec"]
        song.file_uri = f"{settings.minio_bucket}/{best['processed_key']}"
        song.renditions = renditions
        song.error_code = None
        song.error_message = None
        return True

    if event_type == "audio.failed.v1":
        if song.status == SongStatus.PUBLICADO:
            return False  # un fallo tardío no despublica una canción ya lista
        song.status = SongStatus.FALLIDO
        song.error_code = data["error_code"]
        song.error_message = data["error_message"]
        return True

    return False


def _parse_time(value: str) -> datetime:
    return _aware(datetime.fromisoformat(value.replace("Z", "+00:00")))


def apply_user_event(artist: Artist | None, event_type: str, data: dict) -> Artist | None:
    """Crea o actualiza el artista. Devuelve el Artist a guardar, o None si no hay cambios.

    user.registered.v1 no trae fecha: solo crea (si ya llegó un profile_updated, gana ese).
    user.profile_updated.v1 pisa lo guardado salvo que sea más viejo."""
    user_id = uuid.UUID(data["user_id"])
    username = data["username"]
    display_name = data.get("display_name") or username

    if event_type == "user.registered.v1":
        if artist is not None:
            return None
        return Artist(id=user_id, username=username, display_name=display_name, updated_at=None)

    updated_at = _parse_time(data["updated_at"])
    if artist is None:
        return Artist(id=user_id, username=username, display_name=display_name, updated_at=updated_at)
    if artist.updated_at is not None and _aware(artist.updated_at) >= updated_at:
        return None
    artist.username = username
    artist.display_name = display_name
    artist.updated_at = updated_at
    return artist


def _aware(moment: datetime) -> datetime:
    """SQLite (tests) devuelve fechas sin zona; Postgres con zona."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


async def _handle_user_event(session, event_id: str, event_type: str, data: dict) -> str:
    artist = await session.get(Artist, uuid.UUID(data["user_id"]))
    changed = apply_user_event(artist, event_type, data)
    if changed is not None:
        session.add(changed)
    session.add(ProcessedEvent(id=event_id))
    await session.commit()
    return "ok" if changed is not None else "sin_cambios"


async def _handle_user_deleted(session, event_id: str, user_id: uuid.UUID) -> list[tuple[uuid.UUID, str]]:
    """Borra todo lo del usuario. Devuelve (id, título) de las canciones borradas.

    Los archivos se borran antes del commit: si MinIO falla, la excepción hace que
    el mensaje vuelva a la cola y se reintente entero (borrar dos veces no rompe nada)."""
    songs = (await session.scalars(
        select(Song).where(Song.artist_id == user_id).with_for_update()
    )).all()
    for song in songs:
        await minio_client.delete_song_files(song.id)
    song_ids = [song.id for song in songs]
    deleted = [(song.id, song.title) for song in songs]

    playlist_ids = select(Playlist.id).where(Playlist.owner_id == user_id)
    await session.execute(delete(PlaylistSong).where(PlaylistSong.playlist_id.in_(playlist_ids)))
    if song_ids:
        await session.execute(delete(PlaylistSong).where(PlaylistSong.song_id.in_(song_ids)))
        await session.execute(delete(Song).where(Song.id.in_(song_ids)))
    await session.execute(delete(Playlist).where(Playlist.owner_id == user_id))
    await session.execute(delete(Artist).where(Artist.id == user_id))
    session.add(ProcessedEvent(id=event_id))
    await session.commit()
    return deleted


async def _announce_deleted_songs(user_id: uuid.UUID, songs, correlation_id: str | None) -> None:
    """song.deleted.v1 por cada canción: métricas y salas también las sacan.
    El borrado ya está hecho; si RabbitMQ falla queda en el log."""
    for song_id, title in songs:
        try:
            await publisher.publish(
                "song.deleted.v1",
                data={
                    "song_id": str(song_id),
                    "artist_id": str(user_id),
                    "deleted_by": str(user_id),
                    "title": title,
                },
                subject=f"song/{song_id}",
                correlation_id=correlation_id or f"user-deleted-{user_id}",
            )
        except Exception:
            log.exception("Canción %s borrada, pero no se pudo publicar song.deleted.v1", song_id)


async def handle(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    try:
        event = json.loads(message.body)
        event_id = event["id"]
        event_type = event["type"]
        data = event["data"]
        if event_type in SONG_EVENTS:
            song_id = uuid.UUID(data["song_id"])
        elif event_type in USER_EVENTS:
            song_id = None
            uuid.UUID(data["user_id"])
            if not data.get("username"):
                raise KeyError("username")
            if event_type == "user.profile_updated.v1":
                _parse_time(data["updated_at"])
        elif event_type == USER_DELETED:
            song_id = None
            uuid.UUID(data["user_id"])
        else:
            raise KeyError(event_type)
    except (ValueError, KeyError, TypeError) as exc:
        log.error("Mensaje inválido, se descarta: %r", exc)
        await message.reject(requeue=False)
        return

    outcome = "ok"
    deleted_songs = []
    try:
        async with SessionLocal() as session:
            if await session.get(ProcessedEvent, event_id) is not None:
                outcome = "duplicado"
            elif event_type == USER_DELETED:
                deleted_songs = await _handle_user_deleted(session, event_id, uuid.UUID(data["user_id"]))
            elif event_type in USER_EVENTS:
                outcome = await _handle_user_event(session, event_id, event_type, data)
            else:
                song = await session.scalar(
                    select(Song).where(Song.id == song_id).with_for_update()
                )
                if song is None:
                    # Un borrado puede ocurrir mientras el worker transcodifica.
                    # Al llegar su resultado limpiamos las salidas tardías.
                    await minio_client.delete_song_files(song_id)
                    outcome = "sin_cancion"
                else:
                    try:
                        apply_event(song, event_type, data)
                    except (KeyError, TypeError, ValueError) as exc:
                        log.error("Datos inválidos en %s: %r", event_type, exc)
                        outcome = "invalido"
                    else:
                        session.add(ProcessedEvent(id=event_id))
                        await session.commit()
    except Exception:
        log.exception("Error de base de datos; el mensaje vuelve a la cola")
        await asyncio.sleep(5)
        await message.nack(requeue=True)
        return

    if outcome == "sin_cancion":
        # Caso normal, no un error: la canción se borró mientras el worker la
        # procesaba. Ya se limpiaron sus archivos tardíos; no va a la dead-letter.
        log.info("Evento %s de %s, que ya fue borrada: archivos tardíos limpiados", event_type, song_id)
        await message.ack()
        return
    if outcome == "invalido":
        log.warning("Evento %s descartado (%s) para %s", event_type, outcome, song_id)
        await message.reject(requeue=False)
        return
    if outcome == "duplicado":
        log.info("Evento %s ya procesado, se ignora", event_id)
    elif event_type == USER_DELETED:
        log.info("Cuenta %s borrada: %d canciones fuera del catálogo", data["user_id"], len(deleted_songs))
        await _announce_deleted_songs(uuid.UUID(data["user_id"]), deleted_songs, event.get("correlationid"))
    elif event_type in USER_EVENTS:
        log.info("Artista %s: %s (%s)", data["user_id"], event_type, outcome)
    else:
        log.info("Canción %s actualizada por %s cid=%s", song_id, event_type, event.get("correlationid"))
    await message.ack()


async def _run(queue: aio_pika.abc.AbstractQueue) -> None:
    async with queue.iterator() as it:
        async for message in it:
            await handle(message)


async def start():
    """Conecta, declara catalog.q y arranca el consumo en segundo plano."""
    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=10)
    exchange = await channel.declare_exchange(
        settings.events_exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )
    queue = await channel.declare_queue(
        QUEUE, durable=True, arguments={"x-dead-letter-exchange": "musicapp.dlx"}
    )
    for routing_key in BINDINGS:
        await queue.bind(exchange, routing_key=routing_key)
    task = asyncio.create_task(_run(queue))
    log.info("Consumidor listo en %s (%s)", QUEUE, ", ".join(BINDINGS))
    return connection, task
