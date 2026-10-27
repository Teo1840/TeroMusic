import asyncio

from minio import Minio

from .config import settings

client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)


def ensure_buckets() -> None:
    """Crea los buckets si no existen (se llama al arrancar)."""
    for bucket in (settings.raw_bucket, settings.processed_bucket):
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)


def _put(bucket: str, key: str, fileobj, size: int, content_type: str) -> None:
    client.put_object(bucket, key, fileobj, length=size, content_type=content_type)


async def upload_fileobj(bucket: str, key: str, fileobj, size: int, content_type: str):
    # El SDK de MinIO es síncrono: lo corremos en un hilo para no bloquear FastAPI.
    await asyncio.to_thread(_put, bucket, key, fileobj, size, content_type)
