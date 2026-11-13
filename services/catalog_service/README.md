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
| `GET` | `/songs` | Lista las canciones **publicadas**, con `artist_name` |
| `GET` | `/songs/{song_id}` | Estado de una canción (sirve para saber si el worker ya terminó) |
| `GET` | `/playlists` | Playlists del usuario: `[{id, name, song_count}]` |
| `POST` | `/playlists` | Crea una (`{name}`, hasta 100 caracteres). `201` |
| `GET` | `/playlists/{id}` | La playlist con sus canciones en orden (`id, title, duration, status`) |
| `PATCH` | `/playlists/{id}` | Cambia el nombre (`{name}`) |
| `DELETE` | `/playlists/{id}` | Borra la playlist. `204` |
| `POST` | `/playlists/{id}/songs` | Agrega una canción publicada al final (`{song_id}`). `409` si ya está |
| `DELETE` | `/playlists/{id}/songs/{song_id}` | Saca una canción. `204` |
| `PUT` | `/playlists/{id}/songs` | Reordena: `{song_ids}` con exactamente las mismas canciones. `400` si no |
| `GET` | `/health` | Chequeo de vida |

## Playlists

- Son de quien las crea (`X-User-Id`). Las de otro usuario responden `403`; las que no
  existen, `404`.
- Tablas `playlists` y `playlist_songs` (`playlist_id`, `song_id`, `position`). La clave
  `(playlist_id, song_id)` impide repetir una canción en la misma playlist. Se crean solas
  al arrancar, como `songs`.

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

## Artistas

La misma cola recibe `user.registered.v1` y `user.profile_updated.v1` y guarda el nombre
de cada usuario en la tabla `artists`. Con eso `GET /songs`, `GET /songs/{id}` y el detalle
de una playlist devuelven `artist_name` sin consultar a user_service. Si el artista todavía
no llegó, `artist_name` es `null`. Un `user.profile_updated.v1` más viejo que lo guardado
(por `updated_at`) se ignora, y un `user.registered.v1` tardío no pisa un cambio de perfil.

## Para probar

`python peek_events.py` muestra en consola los eventos que pasan por `musicapp.events`.

## Tests

37 tests con pytest. No necesitan Postgres, MinIO ni RabbitMQ: la base es SQLite en
memoria y MinIO y RabbitMQ están simulados ([tests/conftest.py](tests/conftest.py)).

- `tests/test_upload.py`: subida (202, BORRADOR, evento `audio.uploaded.v1` con sus datos,
  `.wav` y `.mp3`), el artista sale de `X-User-Id`, errores 400 / 401 / 413 / 503, y que
  `GET /songs` liste solo las PUBLICADO.
- `tests/test_consumer.py`: `audio.ready` publica y `audio.failed` marca FALLIDO, un fallo
  tardío no despublica, el mismo evento dos veces se aplica una sola vez, los mensajes
  inválidos van a dead-letter y, si la base falla, el mensaje vuelve a la cola.
- `tests/test_playlists.py`: crear, listar solo las propias, renombrar, borrar, agregar
  (`409` repetida, `404` inexistente o sin publicar), sacar, reordenar (`400` si las
  canciones no coinciden) y `403` en todo lo de otro usuario.

Desde la raíz del repo, dentro del contenedor (PowerShell):

```powershell
docker compose run --rm --no-deps -v "${PWD}/services/catalog_service:/code" catalog_service sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```
