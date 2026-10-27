import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import minio_client
from .config import settings
from .database import Base, engine, get_session
from .models import Song, SongStatus


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: crear tablas y buckets
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    minio_client.ensure_buckets()
    yield
    await engine.dispose()


app = FastAPI(title="catalog_service", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/songs/upload", status_code=202)
async def upload_song(
    title: str = Form(...),
    artist_id: uuid.UUID = Form(...),  # más adelante saldrá del JWT
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    # 1. Validar formato
    if not (file.filename or "").lower().endswith(".wav"):
        raise HTTPException(400, "Solo se aceptan archivos .wav")

    # 2. Calcular tamaño sin cargar todo en RAM
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size == 0:
        raise HTTPException(400, "Archivo vacío")
    if size > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"Máximo {settings.max_upload_mb} MB")

    # 3. Subir el original al bucket raw-audio
    song_id = uuid.uuid4()
    key = f"{song_id}.wav"
    await minio_client.upload_fileobj(
        settings.raw_bucket, key, file.file, size, file.content_type or "audio/wav"
    )

    # 4. Guardar en BD como BORRADOR
    song = Song(
        id=song_id,
        title=title,
        artist_id=artist_id,
        status=SongStatus.BORRADOR,
        file_uri=f"{settings.raw_bucket}/{key}",
    )
    session.add(song)
    await session.commit()

    # TODO (Paso 3): publicar audio.uploaded.v1 con publisher.py

    # 5. Respuesta rápida
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
        }
        for s in result.scalars()
    ]
