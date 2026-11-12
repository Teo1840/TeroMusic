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
| `POST` | `/register` | Crea la cuenta (`email`, `password`) y devuelve un token. `409` si el email ya existe |
| `POST` | `/login` | Devuelve un token. `401` si los datos no coinciden |
| `GET` | `/verify` | Valida el token (`Authorization: Bearer ...`). Lo usa el gateway |
| `GET` | `/health` | Chequeo de vida |

## Tokens

- JWT firmado con `JWT_SECRET` (HS256). Dura **60 minutos** (`ACCESS_TOKEN_EXPIRE_MINUTES`).
- Lleva el id del usuario (`sub`), el email y el rol.
- `/verify` responde con las cabeceras `X-User-Id` y `X-User-Role`. El gateway las copia
  a cada pedido, así los demás servicios saben quién es el usuario sin leer el token.

## Eventos

Al registrarse alguien, publica `user.registered.v1` en `musicapp.events` (lo usan
notificaciones y métricas). Se publica después de responder, así el alta no espera a RabbitMQ.
