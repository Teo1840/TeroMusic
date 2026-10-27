import enum
import uuid

from sqlalchemy import Enum, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class SongStatus(str, enum.Enum):
    BORRADOR = "BORRADOR"
    PUBLICADO = "PUBLICADO"


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    artist_id: Mapped[uuid.UUID]
    status: Mapped[SongStatus] = mapped_column(
        Enum(SongStatus), default=SongStatus.BORRADOR
    )
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    # BORRADOR: ruta del original en raw-audio. PUBLICADO: ruta del procesado.
    file_uri: Mapped[str | None] = mapped_column(String(500), nullable=True)
