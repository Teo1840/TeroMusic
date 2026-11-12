import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class SongStatus(str, enum.Enum):
    BORRADOR = "BORRADOR"    # subida, esperando al worker
    PUBLICADO = "PUBLICADO"  # procesada y disponible
    FALLIDO = "FALLIDO"      # el worker no pudo procesarla


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    artist_id: Mapped[uuid.UUID]
    status: Mapped[SongStatus] = mapped_column(
        Enum(SongStatus, native_enum=False, length=20), default=SongStatus.BORRADOR
    )
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    # BORRADOR: ruta del original. PUBLICADO: ruta de la mejor versión procesada.
    file_uri: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Versiones generadas por el worker (processed_key, codec, bitrate_kbps, size_bytes)
    renditions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class ProcessedEvent(Base):
    """Ids de eventos ya consumidos (idempotencia, regla 4 del contrato)."""

    __tablename__ = "processed_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Playlist(Base):
    """Lista de canciones de un usuario."""

    __tablename__ = "playlists"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class PlaylistSong(Base):
    """Canción dentro de una playlist. La clave (playlist, canción) evita repetidas."""

    __tablename__ = "playlist_songs"

    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), primary_key=True
    )
    song_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer)
