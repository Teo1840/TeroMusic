from typing import Annotated

from pydantic import AwareDatetime, BaseModel, Field


Identifier = Annotated[str, Field(strict=True, min_length=1, max_length=128, pattern=r"^\S+$")]


class SongPlayed(BaseModel):
    song_id: Identifier
    user_id: Identifier
    timestamp: AwareDatetime
    event_id: Identifier


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
