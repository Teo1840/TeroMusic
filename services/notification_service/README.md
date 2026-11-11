# Servicio de notificaciones

Consume eventos CloudEvents de `musicapp.events` en la cola durable `notifications.q`.
Guarda el historial en PostgreSQL, esquema propio `notifications` (NOTIFICATION_DB
logica dentro de la instancia compartida; no consulta tablas de otros servicios).

## Eventos y destinatarios

- `user.registered.v1`: bienvenida al `user_id`.
- `room.created.v1`: confirmacion al `host_id`; no difunde salas privadas.
- `audio.uploaded.v1`: guarda `song_id -> uploaded_by`, sin crear una alerta.
- `audio.ready.v1`: confirma el procesamiento al usuario que subio el audio.
- `audio.failed.v1`: informa el fallo al mismo usuario.

Los resultados de audio anteriores a la subida quedan persistidos hasta recibir
el propietario. No se necesita modificar contratos ni productores. La relacion
se conserva tras reinicios. El servicio debe estar escuchando antes de las
subidas: RabbitMQ no reproduce eventos publicados antes de crear su cola.

Valida sobre y payload contra los contratos. Eventos invalidos van a
`musicapp.dlx` / `musicapp.dlq`. Fallos de BD se reencolan con espera.
El ACK se envia despues del commit; event_id unico evita alertas duplicadas.
Los eventos y la alerta se guardan en una transaccion.

## Inicio

Desde la raiz del repositorio, con el `.env` local existente:

```powershell
docker compose up -d --build --wait notification_service
```

Puerto configurable: `NOTIFICATION_PORT=8005`. Documentacion: http://localhost:8005/docs.

## API para el frontend

A traves del gateway: `GET http://localhost:8080/api/v1/notifications/user/{user_id}?limit=50&offset=0`,
con `Authorization: Bearer <token>`. El gateway verifica el token y reemplaza
`X-User-Id` con la identidad autenticada; el servicio devuelve 403 si no coincide
con el usuario solicitado. OPTIONS permite el preflight del frontend.
El acceso directo por localhost:8005 se conserva para desarrollo interno.


`GET /notifications/user/{user_id}?limit=50&offset=0`

Devuelve un array JSON de objetos con `id`, `event_id`, `user_id`, `type`,
`message`, `resource_id`, `created_at` y `received_at`. Fechas ISO 8601 UTC.
Orden: fecha del evento descendente, luego id descendente. Sin historial: `[]`.
`limit`: 1 a 100; `offset`: >= 0; UUID invalido: 422; BD no disponible: 503.
`GET /health`: comprueba PostgreSQL y RabbitMQ.

El endpoint es interno, sin autenticacion propia, igual que metricas. El gateway
que lo exponga debe autenticar al usuario y autorizar el user_id consultado.
El frontend debe renderizar `message` como texto. No envia correo ni push.

## Pruebas

Con el servicio levantado (crean datos UUID de prueba y los eliminan al terminar):

```powershell
docker compose exec notification_service python -m unittest discover -s tests -v
```

Verifica contratos, rechazo de eventos invalidos, persistencia, duplicados,
audio en ambos ordenes y concurrente, aislamiento entre usuarios y paginacion.
