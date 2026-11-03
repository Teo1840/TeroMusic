import asyncio
import hashlib
import logging
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import consumer, minio_client, publisher
from .config import settings
from .database import Base, engine, get_session
from .models import Song, SongStatus


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: tablas, bucket y conexión a RabbitMQ
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    minio_client.ensure_bucket()
    await publisher.connect()
    consumer_conn, consumer_task = await consumer.start()
    yield
    consumer_task.cancel()
    with suppress(asyncio.CancelledError):
        await consumer_task
    await consumer_conn.close()
    await publisher.close()
    await engine.dispose()


logging.basicConfig(level=logging.INFO)

app = FastAPI(title="catalog_service", lifespan=lifespan)


def _sha256(fileobj) -> str:
    h = hashlib.sha256()
    for chunk in iter(lambda: fileobj.read(1024 * 1024), b""):
        h.update(chunk)
    fileobj.seek(0)
    return h.hexdigest()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/songs/upload", status_code=202)
async def upload_song(
    title: str = Form(...),
    artist_id: uuid.UUID = Form(...),  # más adelante saldrá del JWT
    file: UploadFile = File(...),
    x_correlation_id: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    # 1. Validar formato
    if not (file.filename or "").lower().endswith(".wav"):
        raise HTTPException(400, "Solo se aceptan archivos .wav")

    # 2. Tamaño y checksum sin cargar todo en RAM
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size == 0:
        raise HTTPException(400, "Archivo vacío")
    if size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Máximo {settings.max_upload_mb} MB")
    checksum = await asyncio.to_thread(_sha256, file.file)

    # 3. Subir el original a audio/raw/{song_id}.wav
    song_id = uuid.uuid4()
    original_key = f"{settings.raw_prefix}{song_id}.wav"
    await minio_client.upload_fileobj(original_key, file.file, size, "audio/wav")

    # 4. Guardar en BD como BORRADOR
    song = Song(
        id=song_id,
        title=title,
        artist_id=artist_id,
        status=SongStatus.BORRADOR,
        file_uri=f"{settings.minio_bucket}/{original_key}",
    )
    session.add(song)
    await session.commit()

    # 5. Publicar audio.uploaded.v1 (datos según el schema del contrato)
    correlation_id = x_correlation_id or f"req-{uuid.uuid4().hex[:8]}"
    try:
        await publisher.publish(
            "audio.uploaded.v1",
            data={
                "song_id": str(song_id),
                "original_key": original_key,
                "bucket": settings.minio_bucket,
                "uploaded_by": str(artist_id),
                "content_type": "audio/wav",
                "size_bytes": size,
                "checksum_sha256": checksum,
            },
            subject=f"song/{song_id}",
            correlation_id=correlation_id,
        )
    except Exception as exc:
        raise HTTPException(503, f"No se pudo publicar el evento: {exc}")

    # 6. Respuesta rápida
    return {"song_id": str(song_id), "status": song.status.value}


@app.get("/songs")
async def list_songs(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Song).where(Song.status == SongStatus.PUBLICADO)
    )
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "artist_id": str(s.artist_id),
            "duration": s.duration,
            "file_uri": s.file_uri,
            "renditions": s.renditions,
        }
        for s in result.scalars()
    ]


@app.get("/songs/{song_id}")
async def get_song(song_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Estado de una canción (para saber si el worker ya terminó)."""
    song = await session.get(Song, song_id)
    if song is None:
        raise HTTPException(404, "Canción no encontrada")
    return {
        "id": str(song.id),
        "title": song.title,
        "artist_id": str(song.artist_id),
        "status": song.status.value,
        "duration": song.duration,
        "file_uri": song.file_uri,
        "renditions": song.renditions,
        "error_code": song.error_code,
        "error_message": song.error_message,
    }
