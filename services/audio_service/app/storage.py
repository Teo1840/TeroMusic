import mimetypes
import os
from dataclasses import dataclass

from minio import Minio
from minio.error import S3Error


RAW_BUCKET = os.getenv("RAW_BUCKET", "raw-audio")
PROCESSED_BUCKET = os.getenv("PROCESSED_BUCKET", "processed-audio")
CHUNK_SIZE = 64 * 1024

client = Minio(
    os.getenv("MINIO_ENDPOINT", "minio:9000"),
    access_key=os.environ["MINIO_USER"],
    secret_key=os.environ["MINIO_PASS"],
    secure=os.getenv("MINIO_SECURE", "false").lower() == "true",
)


@dataclass
class AudioObject:
    bucket: str
    key: str
    size: int
    content_type: str


def _content_type(key: str, stored: str | None) -> str:
    if stored and stored != "application/octet-stream":
        return stored
    return mimetypes.guess_type(key)[0] or "application/octet-stream"


def find_object(song_id: str) -> AudioObject | None:
    """Busca primero la version procesada y, si no existe, el original."""
    for bucket in (PROCESSED_BUCKET, RAW_BUCKET):
        try:
            for obj in client.list_objects(bucket, prefix=f"{song_id}."):
                stat = client.stat_object(bucket, obj.object_name)
                return AudioObject(
                    bucket, obj.object_name, stat.size,
                    _content_type(obj.object_name, stat.content_type),
                )
        except S3Error as error:
            # Un bucket que todavia no se creo equivale a "no hay archivo ahi".
            if error.code != "NoSuchBucket":
                raise
    return None


def open_range(audio: AudioObject, offset: int, length: int):
    return client.get_object(audio.bucket, audio.key, offset=offset, length=length)


def iter_chunks(response):
    try:
        yield from response.stream(CHUNK_SIZE)
    finally:
        response.close()
        response.release_conn()


def ping() -> None:
    client.bucket_exists(RAW_BUCKET)
