# catalog_service: catálogo de canciones

Recibe las canciones que suben los usuarios, guarda sus datos y avisa al worker para que las
procese. Python + FastAPI, datos en PostgreSQL, archivos en MinIO y eventos en RabbitMQ.

```
docker compose up -d --build catalog_service
```

API en http://localhost:8000/docs. Desde el front, todo pasa por el gateway: `/api/v1/catalog/...`.

---

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/songs/upload` | Sube una canción (`title` + `file`, formulario multipart). Responde `202` con `song_id` |
| `GET` | `/songs` | Lista las canciones **publicadas** |
| `GET` | `/songs/{song_id}` | Estado de una canción (sirve para saber si el worker ya terminó) |
| `GET` | `/health` | Chequeo de vida |

## Subir una canción

- Formatos: **`.wav` y `.mp3`**. Máximo **100 MB** (`MAX_UPLOAD_MB`).
- El artista **no se manda en el formulario**: sale de la cabecera `X-User-Id`, que pone el
  gateway después de validar el JWT. Sin esa cabecera, el servicio responde `401`.
  Por eso el servicio no se debe exponer sin el gateway delante.
- El original queda en MinIO como `audio/raw/{song_id}.wav` (o `.mp3`).

## Ciclo de vida

```
 subir ──► BORRADOR ──audio.ready.v1──► PUBLICADO   (aparece en GET /songs)
               │
               └────audio.failed.v1──► FALLIDO      (error_code y error_message)
```

1. Al subir, publica `audio.uploaded.v1` y la canción queda en `BORRADOR`.
2. El [worker_ingesta](../worker_ingesta/README.md) la convierte a MP3 de 128 y 320 kbps.
3. El catálogo escucha la cola `catalog.q` y actualiza la canción: duración, versiones
   procesadas (`renditions`) y `file_uri` apuntando a la de mejor calidad.

Cada evento se procesa una sola vez (se guarda su `id`). Un fallo que llega tarde no
despublica una canción que ya estaba lista.

## Para probar

`python peek_events.py` muestra en consola los eventos que pasan por `musicapp.events`.

## Tests

22 tests con pytest. No necesitan Postgres, MinIO ni RabbitMQ: la base es SQLite en
memoria y MinIO y RabbitMQ están simulados ([tests/conftest.py](tests/conftest.py)).

- `tests/test_upload.py`: subida (202, BORRADOR, evento `audio.uploaded.v1` con sus datos,
  `.wav` y `.mp3`), el artista sale de `X-User-Id`, errores 400 / 401 / 413 / 503, y que
  `GET /songs` liste solo las PUBLICADO.
- `tests/test_consumer.py`: `audio.ready` publica y `audio.failed` marca FALLIDO, un fallo
  tardío no despublica, el mismo evento dos veces se aplica una sola vez, los mensajes
  inválidos van a dead-letter y, si la base falla, el mensaje vuelve a la cola.

Desde la raíz del repo, dentro del contenedor (PowerShell):

```powershell
docker compose run --rm --no-deps -v "${PWD}/services/catalog_service:/code" catalog_service sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```
