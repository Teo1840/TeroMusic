# worker_ingesta: procesamiento de audio

Toma cada canción subida y la deja lista para escuchar: la convierte a MP3, normaliza el
volumen y genera la forma de onda. Python + FFmpeg. No tiene API: solo escucha RabbitMQ.

```
docker compose up -d --build worker_ingesta
```

---

## Qué hace

```
audio.uploaded.v1 ──► descarga el original de MinIO (audio/raw/...)
                      ├─ 128.mp3        volumen normalizado (LUFS)
                      ├─ 320.mp3
                      └─ waveform.json  200 picos para la barra del reproductor
                  ──► los sube a audio/processed/{song_id}/
                  ──► publica audio.ready.v1  (o audio.failed.v1 si falla)
```

- Escucha la cola `worker_ingesta.q`. Procesa **una canción a la vez** (es trabajo pesado de CPU).
- Acepta cualquier formato que lea FFmpeg (el catálogo hoy deja subir `.wav` y `.mp3`).

## Worker Pool: varias copias

El Compose levanta **3 copias** (`WORKER_REPLICAS` en `.env`). Todas leen de la misma cola, y
como cada una pide un mensaje por vez (`prefetch_count=1`), RabbitMQ le da una canción a cada
copia libre. Si una copia se cae a mitad de una canción, el mensaje no se confirmó y lo toma otra.

```
docker compose logs -f worker_ingesta     # logs de todas las copias (worker_ingesta-1, -2, -3)
docker compose up -d --scale worker_ingesta=5 worker_ingesta   # cambiar la cantidad en el momento
```

Medido con 81 canciones de ~3–4 min en 8 núcleos: con 1 copia, ~30 s por canción (~2 por minuto);
con 3, ~40–50 s cada una porque comparten CPU, pero ~4 por minuto.

El registro de eventos ya procesados es de cada copia (en memoria). Si dos copias procesan la
misma canción, no pasa nada: sobrescriben los mismos archivos en `processed/{song_id}/` y el
catálogo descarta los eventos repetidos.

## Seguridad: formato de entrada

FFmpeg no adivina el formato del archivo: se fuerza según la extensión (`-f wav` o
`-f mp3`) y solo puede abrir archivos locales (`-protocol_whitelist file`). Sin esto, un
`cancion.mp3` que en realidad fuera una playlist HLS (`#EXTM3U` con URLs adentro) haría que el
worker pidiera esas URLs dentro de la red de Docker (MinIO, catálogo, etc.). Ahora ese archivo
es un MP3 roto y termina en `CORRUPT_FILE`. Otra extensión da `UNSUPPORTED_FORMAT` sin
reintento. Los tres pasos (`probe`, `transcode`, `make_waveform`) usan la misma entrada.

## Errores

- Los errores pasajeros se **reintentan hasta 3 veces** (`MAX_ATTEMPTS`), esperando cada vez más.
- Si no se puede, publica `audio.failed.v1` con `error_code` y el catálogo marca la canción como `FALLIDO`.
- Si un evento llega repetido, se ignora.

## Para probar sin Docker ni colas

```
python3 process_local.py ruta/a/cancion.wav
```

Crea la carpeta `salida_<nombre>/` con `128.mp3`, `320.mp3` y `waveform.json`. Necesita FFmpeg instalado.

## Tests

24 tests con pytest (más uno marcado como falla conocida). Los de FFmpeg generan el audio
dentro del test (un tono de 2 s), así que no hacen falta archivos de ejemplo.

- `tests/test_audio_processor.py`: de `.wav` y de `.mp3` salen 128 y 320 kbps con la duración
  correcta y `waveform.json` con 200 picos entre 0 y 1. Archivo corrupto → `CORRUPT_FILE` sin
  reintento, sin audio → `UNSUPPORTED_FORMAT`, demasiado largo → `TOO_LONG`, y una playlist
  HLS con extensión `.mp3` no pide URLs (`CORRUPT_FILE`).
- `tests/test_input_format.py` (no necesita FFmpeg): el formato sale de la extensión, solo se
  permite el protocolo `file`, otras extensiones dan `UNSUPPORTED_FORMAT` y los tres comandos
  usan esa entrada.
- `tests/test_worker.py`: reintentos solo de errores temporales (hasta `max_attempts`), un
  evento repetido no se procesa dos veces, mensajes inválidos a dead-letter, y si no se puede
  publicar el resultado el mensaje vuelve a la cola.

**Falla conocida:** un archivo en silencio total queda FALLIDO, porque `loudnorm` deja valores
inválidos y LAME aborta. El test `test_silencio_da_forma_de_onda_plana` lo documenta
(`xfail`); cuando se arregle, el test avisa para sacar la marca.

Necesitan FFmpeg, así que se corren en la imagen del worker. Desde la raíz del repo (PowerShell):

```powershell
docker compose run --rm --no-deps -v "${PWD}/services/worker_ingesta:/code" worker_ingesta sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```
