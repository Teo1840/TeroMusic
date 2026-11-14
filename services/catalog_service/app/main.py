import asyncio
import hashlib
import logging
import uuid
from contextlib import asynccontextmanager, suppress
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, inspect, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import consumer, minio_client, playlists, publisher
from .auth import ADMIN_ROLE, current_user_id
from .config import settings
from .database import Base, engine, get_session
from .models import Artist, Song, SongStatus


def add_missing_columns(conn) -> None:
    """create_all no agrega columnas a tablas que ya existen: las nuevas van acá."""
    columns = {c["name"] for c in inspect(conn).get_columns("playlists")}
    if "is_public" not in columns:
        conn.execute(text("ALTER TABLE playlists ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE"))
    # Las canciones viejas quedan con NULL (van al final en el orden "newest").
    inspector = inspect(conn)
    if inspector.has_table("songs") and "created_at" not in {c["name"] for c in inspector.get_columns("songs")}:
        conn.execute(text("ALTER TABLE songs ADD COLUMN created_at TIMESTAMP WITH TIME ZONE"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Al arrancar: tablas, bucket y conexión a RabbitMQ
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(add_missing_columns)
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


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="catalog_service", lifespan=lifespan)
app.include_router(playlists.router)


# Formatos aceptados: extensión -> content_type (los dos están en el enum del contrato)
ALLOWED_FORMATS = {".wav": "audio/wav", ".mp3": "audio/mpeg"}
# Igual al String(200) de Song.title: se valida antes de subir el archivo a MinIO.
TITLE_MAX = 200

log = logging.getLogger("catalog")


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
    title: str = Form(..., max_length=TITLE_MAX),
    artist_id: uuid.UUID = Depends(current_user_id),  # sale del JWT vía gateway
    file: UploadFile = File(...),
    x_correlation_id: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    # 1. Validar título y formato (antes de tocar MinIO)
    title = " ".join(title.split())
    if not title:
        raise HTTPException(400, "El título no puede estar vacío")
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
    except Exception:
        # Sin el evento ningún worker la procesa: quedaría en BORRADOR para siempre.
        # Se deshace la subida para que el usuario pueda reintentar. El detalle del
        # error va al log y no a la respuesta (puede traer datos internos).
        log.exception("No se pudo publicar audio.uploaded.v1 de %s; se deshace la subida", song_id)
        await _undo_upload(song_id, session)
        raise HTTPException(503, "No se pudo encolar la canción para procesarla; probá de nuevo")

    # 6. Respuesta rápida
    return {"song_id": str(song_id), "status": song.status.value}


async def _undo_upload(song_id: uuid.UUID, session: AsyncSession) -> None:
    try:
        song = await session.get(Song, song_id)
        if song is not None:
            await session.delete(song)
            await session.commit()
    except Exception:
        log.exception("No se pudo borrar la fila de %s", song_id)
    try:
        await minio_client.delete_song_files(song_id)
    except Exception:
        log.exception("No se pudo borrar el original de %s", song_id)


def _with_artist():
    """Canción + nombre del artista. outer join: si catálogo todavía no recibió
    el evento del usuario, la canción sale igual con artist_name = None."""
    return select(Song, Artist.display_name).outerjoin(Artist, Artist.id == Song.artist_id)


# Paginación de GET /songs: sin ?limit trae SONGS_PAGE_DEFAULT; nunca más de SONGS_PAGE_MAX.
SONGS_PAGE_DEFAULT = 50
SONGS_PAGE_MAX = 200
SONGS_IDS_MAX = 100

# Órdenes de GET /songs. El id al final desempata: la paginación es estable.
SONG_SORTS = {
    "title": lambda: (func.lower(Song.title), Song.id),
    "artist": lambda: (func.lower(Artist.display_name).asc().nulls_last(), func.lower(Song.title), Song.id),
    "longest": lambda: (Song.duration.desc().nulls_last(), func.lower(Song.title), Song.id),
    "shortest": lambda: (Song.duration.asc().nulls_last(), func.lower(Song.title), Song.id),
    "newest": lambda: (Song.created_at.desc().nulls_last(), Song.id),
}


def _like(term: str) -> str:
    """Texto buscado → patrón de ILIKE (los % y _ del usuario se buscan literales)."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _parse_ids(ids: str | None) -> list[uuid.UUID] | None:
    if ids is None:
        return None
    try:
        parsed = list(dict.fromkeys(uuid.UUID(part) for part in ids.split(",") if part.strip()))
    except ValueError:
        raise HTTPException(422, "ids tiene que ser una lista de UUIDs separados por coma")
    if len(parsed) > SONGS_IDS_MAX:
        raise HTTPException(422, f"Como mucho {SONGS_IDS_MAX} ids por pedido")
    return parsed


@app.get("/songs")
async def list_songs(
    response: Response,
    artist_id: uuid.UUID | None = None,
    q: str | None = Query(default=None, max_length=100),
    ids: str | None = Query(default=None, max_length=SONGS_IDS_MAX * 37),
    sort: Literal["title", "artist", "longest", "shortest", "newest"] = "title",
    limit: int = Query(default=SONGS_PAGE_DEFAULT, ge=1, le=SONGS_PAGE_MAX),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    """Canciones publicadas, de a una página. Sigue siendo un array; el total
    (con los mismos filtros, sin limit/offset) va en el header X-Total-Count.

    - artist_id: solo las de ese artista.
    - q: el título o el nombre del artista contiene el texto (sin distinguir mayúsculas).
    - ids: solo esas canciones (coma, hasta 100), p. ej. para ponerle nombre al top de métricas.
    - sort: title (default), artist, longest, shortest, newest.
    - limit / offset: la página (default 50, máximo 200)."""
    conditions = [Song.status == SongStatus.PUBLICADO]
    if artist_id is not None:
        conditions.append(Song.artist_id == artist_id)
    term = " ".join((q or "").split())
    if term:
        pattern = _like(term)
        conditions.append(or_(Song.title.ilike(pattern, escape="\\"),
                              Artist.display_name.ilike(pattern, escape="\\")))
    id_list = _parse_ids(ids)
    if id_list is not None:
        conditions.append(Song.id.in_(id_list))

    total = await session.scalar(
        select(func.count()).select_from(Song)
        .outerjoin(Artist, Artist.id == Song.artist_id).where(*conditions)
    )
    response.headers["X-Total-Count"] = str(total)

    query = _with_artist().where(*conditions).order_by(*SONG_SORTS[sort]()).limit(limit).offset(offset)
    result = await session.execute(query)
    return [
        {
            "id": str(s.id),
            "title": s.title,
            "artist_id": str(s.artist_id),
            "artist_name": artist_name,
            "duration": s.duration,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s, artist_name in result.all()
    ]


@app.get("/artists/{artist_id}")
async def get_artist(artist_id: uuid.UUID, session: AsyncSession = Depends(get_session)):
    """Perfil público de un artista (copia local) y cuántas canciones publicadas tiene.

    404 si catálogo no lo conoce y tampoco tiene canciones suyas. Si tiene canciones
    pero el perfil todavía no llegó por eventos, sale con display_name = None."""
    artist = await session.get(Artist, artist_id)
    song_count = await session.scalar(
        select(func.count()).select_from(Song).where(
            Song.artist_id == artist_id, Song.status == SongStatus.PUBLICADO
        )
    )
    if artist is None and not song_count:
        raise HTTPException(404, "Artista no encontrado")
    return {
        "id": str(artist_id),
        "username": artist.username if artist else None,
        "display_name": artist.display_name if artist else None,
        "song_count": song_count,
    }


@app.get("/songs/mine")
async def my_songs(
    artist_id: uuid.UUID = Depends(current_user_id),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(_with_artist().where(Song.artist_id == artist_id))
    return [_song_detail(song, artist_name) for song, artist_name in result.all()]


@app.delete("/songs/{song_id}", status_code=204)
async def delete_song(
    song_id: uuid.UUID,
    user_id: uuid.UUID = Depends(current_user_id),
    x_user_role: str | None = Header(default=None),
    x_correlation_id: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    # Serializa el borrado con el consumidor mientras se limpia MinIO.
    song = await session.scalar(select(Song).where(Song.id == song_id).with_for_update())
    if song is None:
        raise HTTPException(404, "Canción no encontrada")
    # El dueño o un admin (rol que pone el gateway, leído de user_service).
    if song.artist_id != user_id and x_user_role != ADMIN_ROLE:
        raise HTTPException(403, "Solo podés borrar tus propias canciones")
    artist_id = song.artist_id
    if artist_id != user_id:
        log.info("Admin %s borra la canción %s de %s", user_id, song_id, artist_id)
    try:
        await minio_client.delete_song_files(song_id)
    except Exception:
        logging.exception("No se pudieron borrar los archivos de %s", song_id)
        raise HTTPException(503, "No se pudieron borrar los archivos de la canción")
    title = song.title
    await session.delete(song)
    await session.commit()

    # Avisa (a métricas y salas) que la canción ya no existe. El borrado ya está
    # hecho: si RabbitMQ no responde se registra el error, pero no se deshace.
    try:
        await publisher.publish(
            "song.deleted.v1",
            data={
                "song_id": str(song_id),
                "artist_id": str(artist_id),
                "deleted_by": str(user_id),
                "title": title,
            },
            subject=f"song/{song_id}",
            correlation_id=x_correlation_id or f"req-{uuid.uuid4().hex[:8]}",
        )
    except Exception:
        logging.exception("Canción %s borrada, pero no se pudo publicar song.deleted.v1", song_id)
    return Response(status_code=204)


@app.get("/songs/{song_id}")
async def get_song(
    song_id: uuid.UUID,
    x_user_id: str | None = Header(default=None),
    x_user_role: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Estado de una canción (para saber si el worker ya terminó).

    Dos tipos de pedido:
      - Por el gateway (siempre trae X-User-Id): una canción que no está publicada
        solo la ven su dueño y los admins (para el resto es 404), y nunca salen las
        rutas internas de MinIO (file_uri, renditions). El error del worker solo lo
        ven el dueño y los admins.
      - Interno, de audio_service y rooms_service dentro de Docker (sin X-User-Id):
        la ficha completa, porque audio necesita las renditions para leer el archivo.
        Este puerto no se publica fuera de la PC (127.0.0.1).
    """
    row = (await session.execute(_with_artist().where(Song.id == song_id))).first()
    if row is None:
        raise HTTPException(404, "Canción no encontrada")
    song, artist_name = row
    if x_user_id is None:
        return _song_detail(song, artist_name, internal=True)

    privileged = str(song.artist_id) == x_user_id.lower() or x_user_role == ADMIN_ROLE
    if song.status != SongStatus.PUBLICADO and not privileged:
        raise HTTPException(404, "Canción no encontrada")
    detail = _song_detail(song, artist_name)
    if not privileged:
        detail["error_code"] = detail["error_message"] = None
    return detail


def _song_detail(song: Song, artist_name: str | None = None, internal: bool = False) -> dict:
    """Ficha de una canción. internal=True agrega las rutas de MinIO (file_uri y
    renditions), que solo necesitan los servicios de adentro."""
    detail = {
        "id": str(song.id),
        "title": song.title,
        "artist_id": str(song.artist_id),
        "artist_name": artist_name,
        "status": song.status.value,
        "duration": song.duration,
        "error_code": song.error_code,
        "error_message": song.error_message,
    }
    if internal:
        detail["file_uri"] = song.file_uri
        detail["renditions"] = song.renditions
    return detail
