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
