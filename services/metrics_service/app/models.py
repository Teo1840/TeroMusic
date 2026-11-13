from datetime import date
from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field


Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=r"^\S+$")]


class SongPlayed(BaseModel):
    song_id: Identifier
    user_id: Identifier
    timestamp: AwareDatetime
    event_id: Identifier


class SongDeleted(BaseModel):
    """song.deleted.v1: la canción sale del top y de los contadores."""
    event_id: Identifier
    song_id: Identifier


class DomainEvent(BaseModel):
    """user.registered.v1 o room.created.v1: solo se cuentan."""
    event_id: Identifier
    type: Identifier
    subject_id: Identifier
    timestamp: AwareDatetime


class Summary(BaseModel):
    plays: int
    users: int
    rooms: int


class SongMetrics(BaseModel):
    song_id: str
    total_plays: int


class TotalPlays(BaseModel):
    plays: int


class TopSongs(BaseModel):
    songs: list[SongMetrics]


# Tope por pedido: alcanza para el catálogo de un artista y acota la consulta.
BATCH_MAX = 500


class SongsBatch(BaseModel):
    song_ids: list[Identifier] = Field(min_length=1, max_length=BATCH_MAX)


class DayPlays(BaseModel):
    date: date
    plays: int


class DailyPlays(BaseModel):
    """Reproducciones por día, del más viejo a hoy (todos los días, con 0 si no hubo)."""
    days: list[DayPlays]
    total: int
    tz: str


# Largo máximo de una serie: un año.
DAYS_MAX = 365
TZ_PATTERN = r"^[A-Za-z][A-Za-z0-9_+\-]*(/[A-Za-z0-9_+\-]+)*$"


class SongsDaily(BaseModel):
    song_ids: list[Identifier] = Field(min_length=1, max_length=BATCH_MAX)
    days: int = Field(default=30, ge=1, le=DAYS_MAX)
    tz: str = Field(default="UTC", max_length=64, pattern=TZ_PATTERN)


class TrendingSong(BaseModel):
    song_id: str
    plays: int
    previous_plays: int


class Trending(BaseModel):
    """Últimos `days` días contra los `days` anteriores."""
    days: int
    plays: int
    previous_plays: int
    songs: list[TrendingSong]
