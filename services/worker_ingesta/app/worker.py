"""Worker de transcodificación: consume audio.uploaded.v1 y publica
audio.ready.v1 (éxito) o audio.failed.v1 (fallo definitivo)."""
import asyncio
import json
import logging
import tempfile
import time
import uuid
from pathlib import Path

import aio_pika

from . import minio_client, publisher
from .audio_processor import ProcessingError, process_audio
from .config import settings

log = logging.getLogger("worker")

# Idempotencia básica: ids de eventos ya procesados (se pierde al reiniciar,
# pero reprocesar es seguro porque los archivos se sobrescriben).
_processed_ids: set[str] = set()


async def process_song(data: dict) -> dict:
    """Descarga, transcodifica, sube a processed/ y devuelve el data de audio.ready."""
    started = time.monotonic()
    song_id = data["song_id"]
    bucket = data.get("bucket", settings.minio_bucket)
    original_key = data["original_key"]

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        src = tmp_dir / f"original{Path(original_key).suffix}"
        out_dir = tmp_dir / "out"

        await minio_client.download(bucket, original_key, src)
        result = await asyncio.to_thread(process_audio, src, out_dir)

        prefix = f"{settings.processed_prefix}{song_id}/"
        names = [r["filename"] for r in result["renditions"]] + [result["waveform_file"]]
        for name in names:
            await minio_client.upload(bucket, prefix + name, out_dir / name)

    return {
        "song_id": song_id,
        "duration_sec": result["duration_sec"],
        "renditions": [
            {
                "processed_key": prefix + r["filename"],
                "codec": r["codec"],
                "bitrate_kbps": r["bitrate_kbps"],
                "size_bytes": r["size_bytes"],
            }
            for r in result["renditions"]
        ],
        "processing_ms": int((time.monotonic() - started) * 1000),
    }


def _failed(song_id: str, code: str, message: str, attempts: int, retryable: bool) -> dict:
    return {
        "song_id": song_id,
        "error_code": code,
        "error_message": (message or "Error desconocido")[:1000],
        "attempts": attempts,
        "retryable": retryable,
    }


async def process_with_retries(data: dict) -> tuple[str, dict]:
    """Devuelve (tipo_de_evento, data). Reintenta solo errores 'retryable'."""
    song_id = data["song_id"]
    for attempt in range(1, settings.max_attempts + 1):
        try:
            return "audio.ready.v1", await process_song(data)
        except ProcessingError as e:
            log.warning("Intento %d/%d falló [%s]: %s", attempt, settings.max_attempts, e.code, e.message)
            if not e.retryable or attempt == settings.max_attempts:
                return "audio.failed.v1", _failed(song_id, e.code, e.message, attempt, e.retryable)
            await asyncio.sleep(2**attempt)
        except Exception as e:  # error inesperado: no se reintenta
            log.exception("Error inesperado procesando %s", song_id)
            return "audio.failed.v1", _failed(song_id, "TRANSCODE_ERROR", str(e), attempt, False)
    raise AssertionError("inalcanzable")


async def on_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    try:
        event = json.loads(message.body)
        event_id = event["id"]
        data = event["data"]
        song_id = data["song_id"]
        data["original_key"]
    except (ValueError, KeyError, TypeError) as exc:
        log.error("Mensaje inválido, se descarta: %r", exc)
        await message.reject(requeue=False)
        return

    if event_id in _processed_ids:
        log.info("Evento %s ya procesado, se ignora", event_id)
        await message.ack()
        return

    correlation_id = event.get("correlationid") or f"req-{uuid.uuid4().hex[:8]}"
    log.info("Procesando canción %s", song_id)

    event_type, result_data = await process_with_retries(data)

    try:
        await publisher.publish(event_type, result_data, f"song/{song_id}", correlation_id)
    except Exception:
        log.exception("No se pudo publicar %s; el mensaje vuelve a la cola", event_type)
        await asyncio.sleep(5)
        await message.nack(requeue=True)
        return

    _processed_ids.add(event_id)
    await message.ack()


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    connection = await aio_pika.connect_robust(settings.rabbitmq_url)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=1)  # una canción a la vez (CPU pesada)

    exchange = await channel.declare_exchange(
        settings.events_exchange, aio_pika.ExchangeType.TOPIC, durable=True
    )
    queue = await channel.declare_queue(
        "worker_ingesta.q",
        durable=True,
        arguments={"x-dead-letter-exchange": "musicapp.dlx"},
    )
    await queue.bind(exchange, routing_key="audio.uploaded.v1")
    publisher.init(exchange)

    log.info("Worker listo. Esperando audio.uploaded.v1...")
    async with queue.iterator() as it:
        async for message in it:
            await on_message(message)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
