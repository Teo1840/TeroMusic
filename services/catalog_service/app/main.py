import asyncio
import hashlib
import logging
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import consumer, minio_client, playlists, publisher
from .auth import current_user_id
from .config import settings
from .database import Base, engine, get_session
from .models import Artist, Song, SongStatus


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
app.include_router(playlists.router)


# Formatos aceptados: extensión -> content_type (los dos están en el enum del contrato)
ALLOWED_FORMATS = {".wav": "audio/wav", ".mp3": "audio/mpeg"}


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
    artist_id: uuid.UUID = Depends(current_user_id),  # sale del JWT vía gateway
    file: UploadFile = File(...),
    x_correlation_id: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    # 1. Validar formato
    filename = (file.filename or "").lower()
    ext = next((e for e in ALLOWED_FORMATS if filename.endswith(e)), None)
    if ext is None:
        raise HTTPException(400, "Solo se aceptan archivos .wav o .mp3")
    content_type = ALLOWED_FORMATS[ext]

    # 2. Tamaño y checksum sin cargar todo en RAM
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size == 0:
        raise HTTPException(400, "Archivo vacío")
    if size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Máximo {settings.max_upload_mb} MB")
    checksum = await asyncio.to_thread(_sha256, file.file)

    # 3. Subir el original a audio/raw/{song_id}.{wav|mp3}
    song_id = uuid.uuid4()
    original_key = f"{settings.raw_prefix}{song_id}{ext}"
    await minio_client.upload_fileobj(original_key, file.file, size, content_type)

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
                "content_type": content_type,
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


def _with_artist():
    """Canción + nombre del artista. outer join: si catálogo todavía no recibió
    el evento del usuario, la canción sale igual con artist_name = None."""
    return select(Song, Artist.display_name).outerjoin(Artist, Artist.id == Song.artist_id)


@app.get("/songs")
async def list_songs(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        _with_artist().where(Song.status == SongStatus.PUBLICADO)
    )
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "artist_id": str(s.artist_id),
            "artist_name": artist_name,
            "duration": s.duration,
            "file_uri": s.file_uri,
            "renditions": s.renditions,
        }
        for s, artist_name in result.all()
    ]


@app.get("/songs/{song_id}")
async def get_song(song_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Estado de una canción (para saber si el worker ya terminó)."""
    row = (await session.execute(_with_artist().where(Song.id == song_id))).first()
    if row is None:
        raise HTTPException(404, "Canción no encontrada")
    song, artist_name = row
    return {
        "id": str(song.id),
        "title": song.title,
        "artist_id": str(song.artist_id),
        "artist_name": artist_name,
        "status": song.status.value,
        "duration": song.duration,
        "file_uri": song.file_uri,
        "renditions": song.renditions,
        "error_code": song.error_code,
        "error_message": song.error_message,
    }
