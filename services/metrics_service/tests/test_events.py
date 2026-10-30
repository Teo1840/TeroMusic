import copy
import json
import unittest

from app.events import CONTRACTS, parse_play
from jsonschema.exceptions import ValidationError


class EventContractTest(unittest.TestCase):
    def setUp(self):
        self.event = json.loads(
            (CONTRACTS / "examples/song.played.v1.example.json").read_text()
        )

    def parse(self, event):
        return parse_play(json.dumps(event).encode(), "song.played.v1")

    def test_team_example(self):
        parsed = self.parse(self.event)
        self.assertEqual(parsed.event_id, self.event["id"])
        self.assertEqual(parsed.song_id, self.event["data"]["song_id"])
        self.assertEqual(parsed.timestamp.isoformat(), "2026-10-27T12:11:26+00:00")

    def test_invalid_payloads(self):
        changes = [
            ("song_id", "invalid-uuid"), ("listened_sec", -1),
            ("started_at", "2026-10-27T12:11:26"), ("unknown", 1),
        ]
        for key, value in changes:
            with self.subTest(key=key):
                event = copy.deepcopy(self.event)
                event["data"][key] = value
                with self.assertRaises(ValidationError):
                    self.parse(event)

    def test_invalid_envelope(self):
        self.event.pop("id")
        with self.assertRaises(ValidationError):
            self.parse(self.event)

    def test_wrong_routing_key(self):
        with self.assertRaises(ValueError):
            parse_play(json.dumps(self.event).encode(), "song.played")

    def test_legacy_format_rejected(self):
        with self.assertRaises(ValidationError):
            self.parse({"song_id": "song-123", "user_id": "user-456", "timestamp": "2026-10-26T14:00:00Z"})


if __name__ == "__main__":
    unittest.main()
