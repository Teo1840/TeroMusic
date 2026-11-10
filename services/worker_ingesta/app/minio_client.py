import asyncio
from pathlib import Path

from minio import Minio
from minio.error import S3Error

from .audio_processor import ProcessingError
from .config import settings

client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)

CONTENT_TYPES = {".mp3": "audio/mpeg", ".json": "application/json"}


def _download(bucket: str, key: str, dest: Path) -> None:
    try:
        client.fget_object(bucket, key, str(dest))
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchBucket"):
            raise ProcessingError("FILE_NOT_FOUND", f"No existe {bucket}/{key}")
        raise ProcessingError("STORAGE_ERROR", str(e), retryable=True)
    except Exception as e:  # red caída, MinIO apagado, etc.
        raise ProcessingError("STORAGE_ERROR", str(e), retryable=True)


def _upload(bucket: str, key: str, path: Path) -> None:
    content_type = CONTENT_TYPES.get(path.suffix, "application/octet-stream")
    try:
        client.fput_object(bucket, key, str(path), content_type=content_type)
    except Exception as e:
        raise ProcessingError("STORAGE_ERROR", str(e), retryable=True)


async def download(bucket: str, key: str, dest: Path) -> None:
    await asyncio.to_thread(_download, bucket, key, dest)


async def upload(bucket: str, key: str, path: Path) -> None:
    await asyncio.to_thread(_upload, bucket, key, path)
