"""Run with: docker compose exec -T audio_service python -m tests.integration

Requires metrics_service running (it creates the queue that counts plays).
"""
import io
import json
import os
import time
import wave
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from app import storage


AUDIO_URL = "http://localhost:8000"
METRICS_URL = os.getenv("METRICS_URL", "http://metrics_service:8000")


def silent_wav(seconds=1, rate=8000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(b"\x00\x00" * rate * seconds)
    return buffer.getvalue()


def get(song_id, range_header=None, user="test-user"):
    request = Request(f"{AUDIO_URL}/stream/{song_id}?user_id={user}")
    if range_header:
        request.add_header("Range", range_header)
    try:
        # response.headers is case-insensitive; a plain dict would not be.
        with urlopen(request, timeout=5) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


def total_plays(song_id):
    with urlopen(f"{METRICS_URL}/metrics/songs/{song_id}", timeout=5) as response:
        return json.load(response)["total_plays"]


def main():
    song_id = "integration-audio-" + str(uuid4())
    key = f"{song_id}.wav"
    data = silent_wav()
    if not storage.client.bucket_exists(storage.RAW_BUCKET):
        storage.client.make_bucket(storage.RAW_BUCKET)
    storage.client.put_object(
        storage.RAW_BUCKET, key, io.BytesIO(data), len(data), content_type="audio/wav",
    )
    try:
        assert get("missing-" + song_id)[0] == 404

        # Full file: counts as one play.
        status, headers, body = get(song_id)
        assert status == 200 and body == data, status
        assert headers["Accept-Ranges"] == "bytes"

        # Seeking (mid-file range) and the Safari probe do not count.
        status, headers, body = get(song_id, "bytes=100-199")
        assert status == 206 and body == data[100:200], status
        assert headers["Content-Range"] == f"bytes 100-199/{len(data)}"
        assert get(song_id, "bytes=0-1")[0] == 206
        assert get(song_id, "bytes=-10")[2] == data[-10:]

        assert get(song_id, f"bytes={len(data)}-")[0] == 416

        for _ in range(100):
            if total_plays(song_id) == 1:
                break
            time.sleep(0.1)
        time.sleep(1)  # Give any extra (wrong) event time to arrive.
        assert total_plays(song_id) == 1, total_plays(song_id)
        print("PASS: MinIO -> /stream (200, 206, 404, 416) -> song.played -> metrics")
    finally:
        storage.client.remove_object(storage.RAW_BUCKET, key)


main()
