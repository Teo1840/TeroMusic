import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from app.models import DomainEvent, SongDeleted, SongPlayed


CONTRACTS = Path(__file__).resolve().parents[1] / "contracts"

PLAYED = "song.played.v1"
DELETED = "song.deleted.v1"
# Eventos que solo se cuentan (usuarios registrados y salas creadas).
COUNTED = ("user.registered.v1", "room.created.v1")
TYPES = (PLAYED, DELETED, *COUNTED)


def validator(filename):
    return Draft202012Validator(
        json.loads((CONTRACTS / filename).read_text(encoding="utf-8")),
        format_checker=FormatChecker(),
    )


envelope_validator = validator("envelope.schema.json")
data_validators = {kind: validator(f"events/{kind}.schema.json") for kind in TYPES}
play_validator = data_validators[PLAYED]


def _validated(body: bytes, routing_key: str, allowed) -> dict:
    event = json.loads(body)
    envelope_validator.validate(event)
    if event["type"] not in allowed or routing_key != event["type"]:
        raise ValueError("Unexpected event type or routing key")
    data_validators[event["type"]].validate(event["data"])
    return event


def _to_played(event: dict) -> SongPlayed:
    data = event["data"]
    return SongPlayed(
        event_id=event["id"], song_id=data["song_id"], user_id=data["user_id"],
        timestamp=data["started_at"],
    )


def parse_play(body: bytes, routing_key: str) -> SongPlayed:
    return _to_played(_validated(body, routing_key, (PLAYED,)))


def parse_event(body: bytes, routing_key: str) -> SongPlayed | SongDeleted | DomainEvent:
    """Valida cualquier evento que consume métricas.

    song.played.v1 -> SongPlayed. user.registered.v1 / room.created.v1 -> DomainEvent,
    donde subject_id es el usuario registrado o la sala creada."""
    event = _validated(body, routing_key, TYPES)
    if event["type"] == PLAYED:
        return _to_played(event)
    if event["type"] == DELETED:
        return SongDeleted(event_id=event["id"], song_id=event["data"]["song_id"])
    data = event["data"]
    subject_id = data["user_id"] if event["type"] == "user.registered.v1" else data["room_id"]
    return DomainEvent(
        event_id=event["id"], type=event["type"], subject_id=subject_id,
        timestamp=event["time"],
    )
