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

## Errores

- Los errores pasajeros se **reintentan hasta 3 veces** (`MAX_ATTEMPTS`), esperando cada vez más.
- Si no se puede, publica `audio.failed.v1` con `error_code` y el catálogo marca la canción como `FALLIDO`.
- Si un evento llega repetido, se ignora.

## Para probar sin Docker ni colas

```
python3 process_local.py ruta/a/cancion.wav
```

Crea la carpeta `salida_<nombre>/` con `128.mp3`, `320.mp3` y `waveform.json`. Necesita FFmpeg instalado.
