import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from app.models import SongPlayed


CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"


def validator(filename):
    return Draft202012Validator(
        json.loads((CONTRACTS / filename).read_text(encoding="utf-8")),
        format_checker=FormatChecker(),
    )


envelope_validator = validator("envelope.schema.json")
play_validator = validator("events/song.played.v1.schema.json")


def parse_play(body: bytes, routing_key: str) -> SongPlayed:
    event = json.loads(body)
    envelope_validator.validate(event)
    if event["type"] != "song.played.v1" or routing_key != event["type"]:
        raise ValueError("Unexpected event type or routing key")
    play_validator.validate(event["data"])
    data = event["data"]
    return SongPlayed(
        event_id=event["id"], song_id=data["song_id"], user_id=data["user_id"],
        timestamp=data["started_at"],
    )
