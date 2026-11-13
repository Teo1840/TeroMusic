# gateway: puerta de entrada

Un nginx que recibe todos los pedidos del front, revisa el login y los manda al servicio
correspondiente. Configuración en [nginx.conf](nginx.conf).

```
docker compose up -d --build gateway
```

Escucha en http://localhost:8080.

---

## Rutas

| Ruta | Va a | ¿Pide login? |
|---|---|---|
| `/api/v1/auth/...` | user_service | No (user_service valida el JWT en `/me` y `/admin`) |
| `/api/v1/auth/docs`, `/redoc`, `/openapi.json` | — | `404`: la documentación no se publica |
| `/api/v1/catalog/...` | catalog_service | Sí |
| `/api/v1/audio/...` | audio_service | Sí |
| `/api/v1/audio/stream/...` | audio_service | No: usa una URL firmada que vence |
| `/api/v1/metrics/...` | metrics_service | Sí |
| `/api/v1/notifications/...` | notification_service | Sí |
| `/api/v1/rooms` | rooms_service | Sí |
| `/api/v1/ws/rooms/{id}` | rooms_service (WebSocket) | El token va en el primer mensaje |

## Cómo valida el login

1. Antes de pasar el pedido, consulta `user_service /verify` con el `Authorization` que mandó el cliente.
2. Si el token es válido, agrega `X-User-Id` y `X-User-Role` al pedido. Si no, responde `401`.
   Esos headers se **pisan** siempre: si el cliente manda un `X-User-Role: admin` inventado, no llega.
   El rol lo lee user_service de su base en cada pedido (un cambio de rol vale al instante).
3. También agrega `X-Correlation-Id` para seguir el pedido en los eventos.

## CORS

El front no lo necesita: llama a `/api/v1` por el proxy de Vite, desde su mismo origen. Para
llamadas desde otro origen, solo se acepta `http(s)://localhost:5173` y `127.0.0.1:5173`
(`map $cors_origin` en [nginx.conf](nginx.conf)); a cualquier otro `Origin` no se le manda
`Access-Control-Allow-Origin` y el navegador bloquea la respuesta. Sin `Allow-Credentials`: el
login va en el header `Authorization`, no en cookies. El preflight `OPTIONS` se contesta `204`
antes de validar el login.

Los headers de CORS están en [cors.conf](cors.conf) y los comunes de proxy (`Host`,
`X-Forwarded-*`, `X-Correlation-Id`) en [proxy_headers.conf](proxy_headers.conf). Cada
`location` hace `include` de los dos: en nginx, una location con su propio `add_header` o
`proxy_set_header` no hereda los del bloque `server`.

## Límites de pedidos (por IP)

| Qué | Límite |
|---|---|
| Cualquier pedido | 20 por segundo (ráfagas de 100) |
| Stream de audio (`/audio/stream/`) | 50 por segundo (ráfagas de 200) |
| Login, registro, cambio de contraseña y borrar la cuenta | 30 por minuto |
| Subir canciones | 6 por minuto |

Al pasarse, responde `429`. Tamaño máximo de subida: 100 MB.

La IP sale de `X-Forwarded-For`, que manda el proxy del front. Ese proxy **reemplaza** el
header con la IP real de la conexión ([vite.config.js](../frontend/vite.config.js)) y el
gateway toma solo la última IP (`real_ip_recursive off`). Antes el proxy agregaba su IP al
final de lo que mandaba el cliente y nginx seguía hacia la izquierda, así que con una IP
inventada distinta en cada pedido se salteaba el límite de login. Quien llama directo a
`localhost:8080` (sin el front) todavía puede elegir su IP, pero eso solo se puede desde la
misma PC: el gateway no está abierto a la red.

El stream tiene su propio límite, separado del general: ya lo protege la URL firmada que vence,
y el navegador pide muchos rangos del archivo al adelantar o arrastrar la barra. Las ráfagas
son amplias porque el catálogo carga varios reproductores a la vez y, con Docker Desktop,
todos los dispositivos de la red llegan con la misma IP.
