import asyncio
import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Path, Query, Request
from fastapi.responses import Response, StreamingResponse

from app import storage
from app.publisher import Publisher


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("audio")

SONG_ID = r"^[A-Za-z0-9_-]{1,128}$"
USER_ID = r"^\S{1,128}$"
RANGE = re.compile(r"bytes=(\d*)-(\d*)")

publisher = Publisher()
pending: set[asyncio.Task] = set()


class RangeNotSatisfiable(Exception):
    pass


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Devuelve (inicio, fin) inclusivos, o None para servir el archivo entero."""
    if not header:
        return None
    match = RANGE.fullmatch(header.strip())
    if not match or match[1] == match[2] == "":
        return None  # Rangos multiples o mal formados: se ignoran (RFC 9110).
    if match[1] == "":
        suffix = int(match[2])
        if suffix == 0:
            raise RangeNotSatisfiable
        return max(size - suffix, 0), size - 1
    start = int(match[1])
    end = min(int(match[2]), size - 1) if match[2] else size - 1
    if start >= size or start > end:
        raise RangeNotSatisfiable
    return start, end


def starts_playback(byte_range: tuple[int, int] | None) -> bool:
    """Una reproduccion empieza con una peticion desde el byte 0.

    El navegador pide "bytes=0-" al iniciar y luego rangos intermedios al
    adelantar. Safari primero sondea con "bytes=0-1", que no se cuenta.
    """
    if byte_range is None:
        return True
    start, end = byte_range
    return start == 0 and end >= 2


async def publish_play(song_id: str, user_id: str):
    try:
        event_id = await publisher.publish_song_played(song_id, user_id)
        logger.info("song.played published song_id=%s event_id=%s", song_id, event_id)
    except Exception:
        logger.exception("Could not publish song.played for song_id=%s", song_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await publisher.connect()
    logger.info("Publishing to domain_events/song.played")
    try:
        yield
    finally:
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await publisher.close()


app = FastAPI(title="TeroMusic Audio Streaming", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    try:
        await asyncio.to_thread(storage.ping)
        if not publisher.is_ready():
            raise RuntimeError("RabbitMQ unavailable")
    except Exception:
        raise HTTPException(status_code=503, detail="Dependencies unavailable") from None
    return {"status": "ok"}


@app.get("/stream/{song_id}")
async def stream(
    request: Request,
    song_id: str = Path(pattern=SONG_ID),
    user_id: str | None = Query(None, pattern=USER_ID),
    x_user_id: str | None = Header(None, pattern=USER_ID),
):
    # <audio src> no puede enviar headers, por eso tambien se acepta ?user_id=.
    # Se reemplazara por el usuario del JWT cuando exista el gateway.
    user = x_user_id or user_id
    if user is None:
        raise HTTPException(status_code=400, detail="Falta el header X-User-Id o ?user_id=")

    try:
        audio = await asyncio.to_thread(storage.find_object, song_id)
    except Exception:
        logger.exception("Could not look up audio in MinIO")
        raise HTTPException(status_code=503, detail="Storage unavailable") from None
    if audio is None or audio.size == 0:
        raise HTTPException(status_code=404, detail="Cancion no encontrada")

    try:
        byte_range = parse_range(request.headers.get("range"), audio.size)
    except RangeNotSatisfiable:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{audio.size}"})
    start, end = byte_range or (0, audio.size - 1)
    length = end - start + 1

    try:
        body = await asyncio.to_thread(storage.open_range, audio, start, length)
    except Exception:
        logger.exception("Could not read audio from MinIO")
        raise HTTPException(status_code=503, detail="Storage unavailable") from None

    if starts_playback(byte_range):
        # En segundo plano: publicar no debe retrasar el inicio del audio.
        task = asyncio.create_task(publish_play(song_id, user))
        pending.add(task)
        task.add_done_callback(pending.discard)

    headers = {"Accept-Ranges": "bytes", "Content-Length": str(length)}
    if byte_range:
        headers["Content-Range"] = f"bytes {start}-{end}/{audio.size}"
    return StreamingResponse(
        storage.iter_chunks(body),
        status_code=206 if byte_range else 200,
        media_type=audio.content_type,
        headers=headers,
    )
