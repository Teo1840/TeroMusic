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
| `/login`, `/register` | Entrar y crear cuenta (al registrarse se entra directo). El registro pide un nombre de artista opcional |
| `/catalog` | Canciones publicadas con su artista, buscador (por título o artista), reproductor con forma de onda y selector para agregar a una playlist propia |
| `/playlists` | Crear, buscar y borrar playlists propias |
| `/playlists/:playlistId` | Editar y reordenar canciones, reproducir la playlist completa |
| `/upload` | Subida de canciones (`.wav` o `.mp3`). El título se completa solo con el nombre del archivo y se avisa cuando queda publicada |
| `/my-songs` | Canciones que subió el usuario, en cualquier estado, con opción de borrar. Espera `GET /songs/mine` y `DELETE /songs/{id}` del catálogo, que todavía no existen: hasta entonces muestra "todavía no disponible" |
| `/playlists` | Playlists del usuario: crear, buscar y borrar |
| `/playlists/:playlistId` | Una playlist: renombrar, agregar canciones con el buscador, sacar, reordenar y escuchar |
| `/profile` | Perfil: cabecera con avatar y fecha de alta, resumen de actividad (canciones, playlists, reproducciones y la más escuchada) y cambio del nombre de artista (`GET/PATCH /auth/me`, `/catalog/songs/mine`, `/catalog/playlists`, `/metrics/songs/{id}`) |
| `/rooms` | Lista de salas en vivo y creación de salas |
| `/rooms/:roomId` | Sala en vivo: reproducción sincronizada, cola, sugerencias y buscador de canciones |
| `/metrics` | Métricas de reproducciones |

Mientras estás en una sala en vivo y navegás a otra página, la música sigue sonando y aparece
una barra abajo (qué suena, volver a la sala, silenciar o salir).

Todas, salvo login y registro, piden haber iniciado sesión.

## Cómo habla con el backend

- Todo pedido va a `/api/v1/...`. Vite lo reenvía al gateway (incluidos los WebSockets de las salas).
- El token se guarda en `localStorage` (`access_token`, [src/lib/auth.js](src/lib/auth.js))
  y se manda en cada pedido ([src/api/client.js](src/api/client.js)). Si el gateway responde
  `401`, se vuelve al login.
- Cada reproductor ([src/components/AudioPlayer.jsx](src/components/AudioPlayer.jsx)) pide la URL
  firmada del stream, la forma de onda y la metadata del audio. Para no mandar esos pedidos de
  todas las canciones juntas (el gateway corta con `429` si se pasan del límite), se arma recién
  cuando su tarjeta se acerca a la pantalla.

## Reproducción de playlists

En una playlist, **Reproducir playlist** comienza desde la primera canción publicada.
También se puede tocar el título de una canción para empezar desde ahí. Al terminar,
avanza según el orden actual, omite las no disponibles y se detiene al llegar al final.
El reproductor permite pausar, ir a anterior/siguiente y detener la cola. La cola se
detiene al salir de la pantalla o sacar la canción actual. Si el navegador bloquea
el inicio automático, se muestra un aviso para continuar con el botón Reproducir.

Desde el Catálogo, **Agregar a playlist** carga las playlists propias al abrir el
selector. Permite elegir una, confirma el agregado y avisa si ya contiene la canción.
Si no hay playlists, ofrece un enlace para crear una.

## Tests

`npm test` verifica el avance de la cola, los controles, los cambios de orden,
el borrado de la canción actual, el inicio automático y el agregado desde Catálogo
(incluyendo duplicados, playlists vacías y errores de red). `npm run build` compila
la aplicación para producción.

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
