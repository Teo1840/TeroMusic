"""Procesamiento de audio con FFmpeg (sin dependencias externas de Python).

Convierte un .wav a MP3 de 128 y 320 kbps con volumen normalizado (LUFS),
y genera el waveform (picos) para la barra del reproductor.
"""
import json
import subprocess
import sys
import time
from array import array
from pathlib import Path

LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11"  # estándar de streaming: -14 LUFS
RENDITIONS = [(128, "mp3"), (320, "mp3")]
MAX_DURATION_SEC = 20 * 60
WAVEFORM_POINTS = 200

# Formato de entrada según la extensión (catalog_service solo acepta .wav y .mp3).
# Se fuerza con -f para que FFmpeg no lo adivine por el contenido: un "cancion.mp3"
# que en realidad es una playlist HLS (#EXTM3U) haría que FFmpeg pida URLs de la
# red interna (SSRF). -protocol_whitelist file impide abrir cualquier otro protocolo.
INPUT_FORMATS = {".wav": "wav", ".mp3": "mp3"}


class ProcessingError(Exception):
    """Error con el código que exige audio.failed.v1."""

    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _run(cmd: list[str], error_code: str) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(cmd, capture_output=True)
    except FileNotFoundError:
        raise ProcessingError(
            "TRANSCODE_ERROR", f"No se encontró el programa: {cmd[0]}", retryable=False
        )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip()[-500:]
        raise ProcessingError(error_code, detail or "Error de FFmpeg")
    return result


def _input(src: Path) -> list[str]:
    """Argumentos de entrada seguros para ffprobe/ffmpeg."""
    fmt = INPUT_FORMATS.get(src.suffix.lower())
    if fmt is None:
        raise ProcessingError("UNSUPPORTED_FORMAT", f"Formato no soportado: {src.suffix or '(sin extensión)'}")
    return ["-protocol_whitelist", "file", "-f", fmt, "-i", str(src)]


def probe(src: Path) -> float:
    """Valida el archivo y devuelve su duración en segundos."""
    result = _run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", *_input(src),
        ],
        "CORRUPT_FILE",
    )
    info = json.loads(result.stdout)
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise ProcessingError("UNSUPPORTED_FORMAT", "El archivo no contiene audio")
    try:
        duration = float(info["format"]["duration"])
    except (KeyError, ValueError):
        raise ProcessingError("CORRUPT_FILE", "No se pudo leer la duración")
    if duration <= 0:
        raise ProcessingError("CORRUPT_FILE", "Duración inválida")
    if duration > MAX_DURATION_SEC:
        raise ProcessingError(
            "TOO_LONG", f"Dura {duration:.0f}s, máximo {MAX_DURATION_SEC}s"
        )
    return duration


def transcode(src: Path, dst: Path, bitrate_kbps: int) -> None:
    _run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            *_input(src), "-vn",
            "-af", LOUDNORM,
            "-c:a", "libmp3lame", "-b:a", f"{bitrate_kbps}k",
            str(dst),
        ],
        "TRANSCODE_ERROR",
    )


def make_waveform(src: Path, dst: Path, points: int = WAVEFORM_POINTS) -> int:
    """Decodifica a mono 8 kHz y guarda `points` picos normalizados (0 a 1)."""
    result = _run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", *_input(src),
            "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
        ],
        "TRANSCODE_ERROR",
    )
    samples = array("h")
    samples.frombytes(result.stdout[: len(result.stdout) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        raise ProcessingError("CORRUPT_FILE", "El audio no tiene muestras")

    points = min(points, len(samples))
    bucket = len(samples) // points
    peaks = [
        round(max(map(abs, samples[i * bucket:(i + 1) * bucket])) / 32768, 3)
        for i in range(points)
    ]
    dst.write_text(json.dumps({"version": 1, "points": points, "peaks": peaks}))
    return points


def process_audio(src: Path, out_dir: Path) -> dict:
    """Pipeline completo. Deja en out_dir: 128.mp3, 320.mp3 y waveform.json."""
    started = time.monotonic()
    out_dir.mkdir(parents=True, exist_ok=True)

    duration = probe(src)

    renditions = []
    for bitrate, codec in RENDITIONS:
        filename = f"{bitrate}.{codec}"
        dst = out_dir / filename
        transcode(src, dst, bitrate)
        renditions.append(
            {
                "filename": filename,
                "codec": codec,
                "bitrate_kbps": bitrate,
                "size_bytes": dst.stat().st_size,
            }
        )

    points = make_waveform(src, out_dir / "waveform.json")

    return {
        "duration_sec": round(duration, 2),
        "renditions": renditions,
        "waveform_file": "waveform.json",
        "waveform_points": points,
        "processing_ms": int((time.monotonic() - started) * 1000),
    }
