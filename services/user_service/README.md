# user_service: usuarios y login

Registro, login y validación de tokens. Python + FastAPI, usuarios en PostgreSQL, contraseñas
con hash y tokens JWT.

```
docker compose up -d --build user_service
```

API en http://localhost:8011/docs. Desde el front: `/api/v1/auth/...`.

---

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/register` | Crea la cuenta (`email`, `password`, `display_name` opcional) y devuelve un token. `409` si el email ya existe, `422` si la contraseña no cumple las reglas |
| `POST` | `/login` | Devuelve un token. `401` si los datos no coinciden |
| `GET` | `/verify` | Valida el token (`Authorization: Bearer ...`). Lo usa el gateway |
| `GET` | `/me` | Perfil del usuario del token: `id`, `email`, `username`, `display_name`, `role`, `created_at` |
| `PATCH` | `/me` | Cambia el nombre de artista (`{display_name}`, 1 a 64 caracteres). `422` si viene vacío |
| `GET` | `/health` | Chequeo de vida |

## Tokens

- JWT firmado con `JWT_SECRET` (HS256). Dura **60 minutos** (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- Lleva el id del usuario (`sub`), el email y el rol.
- `/verify` responde con las cabeceras `X-User-Id` y `X-User-Role`. El gateway las copia
  a cada pedido, así los demás servicios saben quién es el usuario sin leer el token.

## Contraseñas y login

- Al registrarse, la contraseña tiene que tener **entre 8 caracteres y 72 bytes**. El tope es
  porque bcrypt solo usa los primeros 72 bytes: más largo no suma seguridad. Al entrar no se
  exige el mínimo, para que las cuentas creadas antes de la regla sigan funcionando.
- Si el email no existe, `/login` igual compara contra un hash de relleno. Así tarda lo mismo
  que con una contraseña incorrecta y no se puede averiguar qué emails están registrados.
- Dos registros simultáneos con el mismo email: el índice único frena al segundo y responde
  `409` (antes era un `500`).
- Los intentos de login y registro también están limitados por IP en el gateway.

## Eventos

Al registrarse alguien, publica `user.registered.v1` en `musicapp.events` (lo usan
notificaciones, métricas y catálogo). Se publica después de responder, así el alta no espera a RabbitMQ.

## Nombre de artista

- `display_name` es el nombre que se ve en el catálogo. Si no se manda al registrarse, se usa
  la parte del email antes de la `@`.
- Cada cambio con `PATCH /me` publica `user.profile_updated.v1` con el perfil completo y
  `updated_at`. Catálogo guarda una copia en su tabla `artists`.
- Por el gateway es `/api/v1/auth/me` (lleva el `Authorization`; el JWT se valida acá).
- Cuentas creadas antes de este cambio: al arrancar, el servicio les pone el nombre del
  email y publica `user.profile_updated.v1`. Usa `mandatory`: si catálogo todavía no conectó
  su cola, la cuenta queda pendiente y se reintenta cada 10 s (hasta 5 minutos).

## Tests

Tests con pytest, sin Postgres ni RabbitMQ: la base es SQLite en memoria y la
publicación de eventos está simulada ([tests/conftest.py](tests/conftest.py)).

```
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest
```

- `tests/test_auth.py`: registro con token y evento, contraseñas cortas o de más de 72 bytes
  (`422`), email repetido y registro simultáneo (`409`), login correcto e incorrecto con la
  misma respuesta, cuentas viejas con contraseña corta siguen entrando, el hash de relleno
  cuando el email no existe, contraseñas en el límite (8 caracteres, 72 bytes) y login con
  contraseña enorme rechazado sin calcular bcrypt.
