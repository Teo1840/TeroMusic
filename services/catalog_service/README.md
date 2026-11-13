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
| `GET` | `/songs` | Lista las canciones **publicadas**, con `artist_name`, de a páginas (ver abajo) |
| `GET` | `/artists/{artist_id}` | Perfil público de un artista: `{id, username, display_name, song_count}`. `404` si no se lo conoce ni tiene canciones |
| `GET` | `/songs/mine` | Canciones del usuario autenticado en cualquier estado, con errores y duración |
| `DELETE` | `/songs/{song_id}` | Borra una canción propia (o cualquiera, si es admin) y sus archivos. `204`, `403` si es ajena, `404` si no existe |
| `GET` | `/songs/{song_id}` | Estado de una canción (sirve para saber si el worker ya terminó). Ver abajo quién ve qué |
| `GET` | `/playlists` | Playlists del usuario: `[{id, name, is_public, song_count}]` |
| `POST` | `/playlists` | Crea una (`{name, is_public?}`, hasta 100 caracteres; privada por defecto). `201` |
| `GET` | `/playlists/{id}` | La playlist (`is_public, is_owner, owner_name`) con sus canciones en orden (`id, title, duration, status`). Si es compartida, la puede ver cualquiera |
| `PATCH` | `/playlists/{id}` | Cambia el nombre y/o la visibilidad (`{name?, is_public?}`) |
| `DELETE` | `/playlists/{id}` | Borra la playlist. `204` |
| `POST` | `/playlists/{id}/songs` | Agrega una canción publicada al final (`{song_id}`). `409` si ya está |
| `DELETE` | `/playlists/{id}/songs/{song_id}` | Saca una canción. `204` |
| `PUT` | `/playlists/{id}/songs` | Reordena: `{song_ids}` con exactamente las mismas canciones. `400` si no |
| `GET` | `/health` | Chequeo de vida |

## Listado paginado (`GET /songs`)

Devuelve un array (como siempre) y el total con esos filtros en el header `X-Total-Count`.

| Parámetro | |
|---|---|
| `limit`, `offset` | Página. `limit` 50 por defecto, máximo 200 |
| `sort` | `title` (default), `artist`, `longest`, `shortest`, `newest`. Desempata por id: la paginación es estable |
| `q` | El título o el nombre del artista contiene el texto (sin distinguir mayúsculas) |
| `artist_id` | Solo las de ese artista |
| `ids` | Solo esas canciones, separadas por coma (hasta 100). Métricas lo usa para nombrar el top |

`created_at` se agregó a `songs` para el orden `newest`; las canciones viejas lo tienen en `null`
y van al final.

## Cuenta borrada (`user.deleted.v1`)

Se borran sus canciones (con sus archivos en MinIO, antes del commit: si MinIO falla el mensaje
vuelve a la cola), sus playlists, sus canciones dentro de playlists ajenas y su fila en `artists`.
Después se publica un `song.deleted.v1` por canción para que métricas y salas también las saquen.

## Quién ve qué

- Por el gateway nunca salen las rutas internas de MinIO (`file_uri`, `renditions`): ni en `/songs`,
  ni en `/songs/mine`, ni en `/songs/{id}`.
- `GET /songs/{id}` de una canción **no publicada** (BORRADOR o FALLIDO) solo la ven su dueño y
  los admins; para el resto es `404`. El error del worker (`error_code`, `error_message`) también
  es solo para ellos.
- audio_service y rooms_service llaman a `GET /songs/{id}` adentro de Docker, **sin** `X-User-Id`:
  reciben la ficha completa, con las renditions que necesita audio para leer el archivo. El gateway
  siempre manda `X-User-Id`, así que un pedido de afuera no puede hacerse pasar por interno, y el
  puerto 8000 solo se publica en `127.0.0.1`.
- El rol llega en `X-User-Role` (lo pone el gateway; user_service lo lee de su base). Con
  `admin` se puede borrar cualquier canción: `song.deleted.v1` lleva `deleted_by` con el admin.

## Playlists

- Son de quien las crea (`X-User-Id`) y solo esa persona puede modificarlas.
- Privadas por defecto. Con `is_public` (compartida con link) cualquier usuario con sesión
  puede hacer el `GET /playlists/{id}` para verla y escucharla; no aparece en el listado de
  los demás. Una privada de otro usuario responde `403`; una que no existe, `404`.
- La columna `is_public` se agrega sola al arrancar si la tabla es de antes (`add_missing_columns`).
- Tablas `playlists` y `playlist_songs` (`playlist_id`, `song_id`, `position`). La clave
  `(playlist_id, song_id)` impide repetir una canción en la misma playlist. Se crean solas
  al arrancar, como `songs`.

## Subir una canción

- Formatos: **`.wav` y `.mp3`**. Máximo **100 MB** (`MAX_UPLOAD_MB`).
- El artista **no se manda en el formulario**: sale de la cabecera `X-User-Id`, que pone el
  gateway después de validar el JWT. Sin esa cabecera, el servicio responde `401`.
  Por eso el servicio no se debe exponer sin el gateway delante.
- El original queda en MinIO como `audio/raw/{song_id}.wav` (o `.mp3`).
- El título se limpia (espacios de más) y tiene que tener **entre 1 y 200 caracteres**:
  vacío responde `400` y más largo `422`. Se valida antes de subir nada, así un título
  inválido no deja archivos huérfanos en MinIO.
- Si no se puede publicar `audio.uploaded.v1` (RabbitMQ caído), se **deshace la subida**
  (se borran la fila y el original) y responde `503` para reintentar. Antes la canción quedaba
  en BORRADOR para siempre, porque ningún worker se enteraba. El detalle del error va al log,
  no a la respuesta.

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

El borrado elimina el original y toda la carpeta procesada (versiones, waveform y
archivos parciales). Si MinIO falla, responde `503` y conserva la canción para
reintentar. Si el worker termina después del borrado, el consumidor limpia sus
archivos tardíos; los fallos de esa limpieza se reintentan por RabbitMQ.

## Artistas

La misma cola recibe `user.registered.v1` y `user.profile_updated.v1` y guarda el nombre
de cada usuario en la tabla `artists`. Con eso `GET /songs`, `GET /songs/{id}` y el detalle
de una playlist devuelven `artist_name` sin consultar a user_service. Si el artista todavía
no llegó, `artist_name` es `null`. Un `user.profile_updated.v1` más viejo que lo guardado
(por `updated_at`) se ignora, y un `user.registered.v1` tardío no pisa un cambio de perfil.

La página de cada artista del front usa `GET /artists/{id}` y `GET /songs?artist_id={id}`.
Si el artista tiene canciones pero su perfil todavía no llegó, sale con `display_name: null`.

## Para probar

`python peek_events.py` muestra en consola los eventos que pasan por `musicapp.events`.

## Tests

Tests con pytest. No necesitan Postgres, MinIO ni RabbitMQ: la base es SQLite en
memoria y MinIO y RabbitMQ están simulados ([tests/conftest.py](tests/conftest.py)).

- `tests/test_upload.py`: subida (202, BORRADOR, evento `audio.uploaded.v1` con sus datos,
  `.wav` y `.mp3`), el artista sale de `X-User-Id`, errores 400 / 401 / 413 / 503, título
  vacío o largo sin subir nada, si RabbitMQ falla no queda la canción ni el archivo, y que
  `GET /songs` liste solo las PUBLICADO.
- `tests/test_my_songs.py`: listado propio, autenticación, borrado en todos los estados,
  permisos, reintentos ante fallos de MinIO y limpieza completa de archivos.
- `tests/test_consumer.py`: `audio.ready` publica y `audio.failed` marca FALLIDO, un fallo
  tardío no despublica, el mismo evento dos veces se aplica una sola vez, los mensajes
  inválidos van a dead-letter y, si la base falla, el mensaje vuelve a la cola.
- `tests/test_playlists.py`: crear, listar solo las propias, renombrar, borrar, agregar
  (`409` repetida, `404` inexistente o sin publicar), sacar, reordenar (`400` si las
  canciones no coinciden), `403` en todo lo de otro usuario, compartir / dejar de compartir
  (otro la ve pero no la edita) y agregar `is_public` a una tabla vieja.

Desde la raíz del repo, dentro del contenedor (PowerShell):

```powershell
docker compose run --rm --no-deps -v "${PWD}/services/catalog_service:/code" catalog_service sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"
```
