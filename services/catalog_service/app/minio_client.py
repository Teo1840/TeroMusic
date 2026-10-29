import asyncio

from minio import Minio

from .config import settings

client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)


def ensure_bucket() -> None:
    """Crea el bucket del contrato si no existe (se llama al arrancar)."""
    if not client.bucket_exists(settings.minio_bucket):
        client.make_bucket(settings.minio_bucket)


def _put(key: str, fileobj, size: int, content_type: str) -> None:
    client.put_object(
        settings.minio_bucket, key, fileobj, length=size, content_type=content_type
    )


async def upload_fileobj(key: str, fileobj, size: int, content_type: str):
    # El SDK de MinIO es síncrono: lo corremos en un hilo para no bloquear FastAPI.
    await asyncio.to_thread(_put, key, fileobj, size, content_type)
