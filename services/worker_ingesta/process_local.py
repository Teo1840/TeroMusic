"""Prueba local del pipeline de audio (sin RabbitMQ ni MinIO).

Uso:  python3 process_local.py ruta/a/cancion.wav
Crea la carpeta salida_<nombre>/ con 128.mp3, 320.mp3 y waveform.json.
"""
import json
import sys
import uuid
from pathlib import Path

from app.audio_processor import ProcessingError, process_audio


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Uso: python3 process_local.py ruta/a/cancion.wav")

    src = Path(sys.argv[1]).expanduser()
    if not src.exists():
        sys.exit(f"No existe el archivo: {src}")

    out_dir = Path(f"salida_{src.stem}")
    try:
        result = process_audio(src, out_dir)
    except ProcessingError as e:
        sys.exit(f"FALLÓ [{e.code}]: {e.message}")

    song_id = str(uuid.uuid4())
    data = {
        "song_id": song_id,
        "duration_sec": result["duration_sec"],
        "renditions": [
            {
                "processed_key": f"processed/{song_id}/{r['filename']}",
                "codec": r["codec"],
                "bitrate_kbps": r["bitrate_kbps"],
                "size_bytes": r["size_bytes"],
            }
            for r in result["renditions"]
        ],
        "processing_ms": result["processing_ms"],
    }
    print(f"Listo en {result['processing_ms']} ms. Archivos en: {out_dir}/")
    print(f"Waveform: {result['waveform_points']} puntos")
    print("\nAsí quedaría el data de audio.ready.v1:")
    print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
