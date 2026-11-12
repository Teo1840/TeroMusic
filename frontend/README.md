# frontend

La aplicación web. React + Vite + Tailwind.

```
docker compose up -d --build frontend
```

Abrir http://localhost:5173.

Para mostrarla a otros dispositivos de la red local, poner `FRONTEND_BIND=0.0.0.0` en el `.env`.
Es el único puerto que se abre: el resto de los servicios sigue accesible solo desde esta PC.

---

## Pantallas

| Ruta | Qué hay |
|---|---|
| `/login`, `/register` | Entrar y crear cuenta (al registrarse se entra directo) |
| `/catalog` | Canciones publicadas, buscador y reproductor |
| `/upload` | Subida de canciones (`.wav` o `.mp3`). El título se completa solo con el nombre del archivo y se avisa cuando queda publicada |
| `/rooms` | Lista de salas en vivo y creación de salas |
| `/rooms/:roomId` | Sala en vivo: reproducción sincronizada, cola, sugerencias y buscador de canciones |
| `/metrics` | Métricas de reproducciones |

Todas, salvo login y registro, piden haber iniciado sesión.

## Cómo habla con el backend

- Todo pedido va a `/api/v1/...`. Vite lo reenvía al gateway (incluidos los WebSockets de las salas).
- El token se guarda en `localStorage` (`access_token`, [src/lib/auth.js](src/lib/auth.js))
  y se manda en cada pedido ([src/api/client.js](src/api/client.js)). Si el gateway responde
  `401`, se vuelve al login.

## Estilo

Blanco y negro, bordes rectos y sin sombras. Las clases que se repiten (`btn`, `btn-primary`,
`field`, `card`, `notice`, …) están en [src/index.css](src/index.css): cambiarlas ahí cambia
toda la app.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `src/pages` | Una pantalla por archivo |
| `src/components` | Reproductor, cola de la sala, buscador, formulario de subida, formulario de login/registro, barra de navegación |
| `src/lib` | Audio, conexión a las salas, sesión (token) y formato (tiempos, búsqueda, mensajes de error) |
| `src/api` | Cliente HTTP |

## Sin Docker

```
npm install
npm run dev
```

El proxy de [vite.config.js](vite.config.js) apunta a `http://gateway:80`, que solo existe
dentro de Docker. Para correrlo fuera, cambiarlo a `http://localhost:8080`.
