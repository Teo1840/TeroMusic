"""Playlists de cada usuario: crear, renombrar, borrar, agregar/sacar canciones y reordenar.

El dueño sale de X-User-Id (lo pone el gateway). Una playlist de otro usuario responde 403.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import current_user_id
from .database import get_session
from .models import Artist, Playlist, PlaylistSong, Song, SongStatus

router = APIRouter(prefix="/playlists", tags=["playlists"])


class PlaylistName(BaseModel):
    name: str = Field(max_length=100)

    @field_validator("name")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre no puede estar vacío")
        return value


class AddSong(BaseModel):
    song_id: uuid.UUID


class Reorder(BaseModel):
    song_ids: list[uuid.UUID]


async def _own_playlist(playlist_id: uuid.UUID, user_id: uuid.UUID, session: AsyncSession) -> Playlist:
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None:
        raise HTTPException(404, "Playlist no encontrada")
    if playlist.owner_id != user_id:
        raise HTTPException(403, "La playlist es de otro usuario")
    return playlist


async def _song_ids(playlist_id: uuid.UUID, session: AsyncSession) -> list[uuid.UUID]:
    result = await session.execute(
        select(PlaylistSong.song_id)
        .where(PlaylistSong.playlist_id == playlist_id)
        .order_by(PlaylistSong.position)
    )
    return list(result.scalars())


def _summary(playlist: Playlist, song_count: int) -> dict:
    return {"id": str(playlist.id), "name": playlist.name, "song_count": song_count}


@router.get("")
async def list_playlists(
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Playlists del usuario, la más nueva primero."""
    count = (
        select(PlaylistSong.playlist_id, func.count().label("n"))
        .group_by(PlaylistSong.playlist_id)
        .subquery()
    )
    result = await session.execute(
        select(Playlist, func.coalesce(count.c.n, 0))
        .outerjoin(count, count.c.playlist_id == Playlist.id)
        .where(Playlist.owner_id == user_id)
        .order_by(Playlist.created_at.desc())
    )
    return [_summary(playlist, n) for playlist, n in result.all()]


@router.post("", status_code=201)
async def create_playlist(
    body: PlaylistName,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    playlist = Playlist(owner_id=user_id, name=body.name)
    session.add(playlist)
    await session.commit()
    return _summary(playlist, 0)


@router.get("/{playlist_id}")
async def get_playlist(
    playlist_id: uuid.UUID,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    """La playlist con sus canciones en orden (status dice si se puede reproducir)."""
    playlist = await _own_playlist(playlist_id, user_id, session)
    result = await session.execute(
        select(Song, Artist.display_name)
        .join(PlaylistSong, PlaylistSong.song_id == Song.id)
        .outerjoin(Artist, Artist.id == Song.artist_id)
        .where(PlaylistSong.playlist_id == playlist_id)
        .order_by(PlaylistSong.position)
    )
    return {
        "id": str(playlist.id),
        "name": playlist.name,
        "songs": [
            {
                "id": str(s.id),
                "title": s.title,
                "artist_name": artist_name,
                "duration": s.duration,
                "status": s.status.value,
            }
            for s, artist_name in result.all()
        ],
    }


@router.patch("/{playlist_id}")
async def rename_playlist(
    playlist_id: uuid.UUID,
    body: PlaylistName,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    playlist = await _own_playlist(playlist_id, user_id, session)
    playlist.name = body.name
    await session.commit()
    return {"id": str(playlist.id), "name": playlist.name}


@router.delete("/{playlist_id}", status_code=204)
async def delete_playlist(
    playlist_id: uuid.UUID,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    playlist = await _own_playlist(playlist_id, user_id, session)
    # Explícito además del ON DELETE CASCADE (SQLite no lo aplica por defecto).
    await session.execute(delete(PlaylistSong).where(PlaylistSong.playlist_id == playlist_id))
    await session.delete(playlist)
    await session.commit()
    return Response(status_code=204)


@router.post("/{playlist_id}/songs", status_code=201)
async def add_song(
    playlist_id: uuid.UUID,
    body: AddSong,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Agrega una canción publicada al final."""
    await _own_playlist(playlist_id, user_id, session)

    song = await session.get(Song, body.song_id)
    if song is None or song.status != SongStatus.PUBLICADO:
        raise HTTPException(404, "Canción no encontrada")

    if await session.get(PlaylistSong, (playlist_id, body.song_id)) is not None:
        raise HTTPException(409, "La canción ya está en la playlist")

    last = await session.scalar(
        select(func.max(PlaylistSong.position)).where(PlaylistSong.playlist_id == playlist_id)
    )
    position = 0 if last is None else last + 1
    session.add(PlaylistSong(playlist_id=playlist_id, song_id=body.song_id, position=position))
    await session.commit()
    return {"song_id": str(body.song_id), "position": position}


@router.delete("/{playlist_id}/songs/{song_id}", status_code=204)
async def remove_song(
    playlist_id: uuid.UUID,
    song_id: uuid.UUID,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    await _own_playlist(playlist_id, user_id, session)
    item = await session.get(PlaylistSong, (playlist_id, song_id))
    if item is None:
        raise HTTPException(404, "La canción no está en la playlist")
    await session.delete(item)
    await session.commit()
    return Response(status_code=204)


@router.put("/{playlist_id}/songs")
async def reorder_songs(
    playlist_id: uuid.UUID,
    body: Reorder,
    user_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    """Orden nuevo completo: tiene que traer exactamente las canciones que ya están."""
    await _own_playlist(playlist_id, user_id, session)

    current = await _song_ids(playlist_id, session)
    if len(body.song_ids) != len(set(body.song_ids)) or set(body.song_ids) != set(current):
        raise HTTPException(400, "song_ids tiene que tener las mismas canciones de la playlist, sin repetir")

    items = await session.execute(select(PlaylistSong).where(PlaylistSong.playlist_id == playlist_id))
    position = {song_id: i for i, song_id in enumerate(body.song_ids)}
    for item in items.scalars():
        item.position = position[item.song_id]
    await session.commit()
    return {"song_ids": [str(s) for s in body.song_ids]}
