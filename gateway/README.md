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
| `/api/v1/auth/...` | user_service | No |
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
3. También agrega `X-Correlation-Id` para seguir el pedido en los eventos.

## Límites de pedidos (por IP)

| Qué | Límite |
|---|---|
| Cualquier pedido | 20 por segundo (ráfagas de 40) |
| Login y registro | 30 por minuto |
| Subir canciones | 6 por minuto |

Al pasarse, responde `429`. Tamaño máximo de subida: 100 MB.
