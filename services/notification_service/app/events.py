import json
import os
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

CONTRACTS = Path(os.environ["CONTRACTS_DIR"]) if "CONTRACTS_DIR" in os.environ else next(
    parent / "contracts" for parent in Path(__file__).resolve().parents
    if (parent / "contracts" / "envelope.schema.json").exists()
)
TYPES = ("user.registered.v1", "room.created.v1", "audio.uploaded.v1", "audio.ready.v1", "audio.failed.v1")
def validator(name):
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text(encoding="utf-8")), format_checker=FormatChecker())
ENVELOPE = validator("envelope.schema.json")
PAYLOADS = {kind: validator(f"events/{kind}.schema.json") for kind in TYPES}

def parse_event(body, routing_key):
    event = json.loads(body)
    ENVELOPE.validate(event)
    if event["type"] not in TYPES or event["type"] != routing_key:
        raise ValueError("Unexpected event type or routing key")
    PAYLOADS[event["type"]].validate(event["data"])
    return event
