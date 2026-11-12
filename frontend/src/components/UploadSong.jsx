import { useEffect, useRef, useState } from "react";
import api from "../api/client";

const POLL_MS = 2000;
const MAX_POLLS = 90; // ~3 minutos esperando al worker

// El user_id viaja en el "sub" del JWT; lo usamos como artist_id.
function getUserIdFromToken() {
    const token = localStorage.getItem("access_token");
    if (!token) return null;

    try {
        const payload = token.split(".")[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/");
        return JSON.parse(atob(payload)).sub || null;
    } catch {
        return null;
    }
}

// "mi_cancion-final.wav" → "mi cancion final"
function titleFromFileName(name) {
    return name
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export default function UploadSong({ onPublished }) {

    const [title, setTitle] = useState("");
    const [file, setFile] = useState(null);
    const [status, setStatus] = useState("idle"); // idle | uploading | processing | done | error
    const [message, setMessage] = useState("");
    const [progress, setProgress] = useState(0);

    const fileInput = useRef(null);
    const autoTitle = useRef("");   // último título puesto a partir del nombre del archivo
    const pollTimer = useRef(null);

    // Cortar el polling si se sale de la página.
    useEffect(() => () => clearTimeout(pollTimer.current), []);

    function pollStatus(songId, attempt = 0) {
        pollTimer.current = setTimeout(async () => {
            try {
                const { data } = await api.get(`/catalog/songs/${songId}`);

                if (data.status === "PUBLICADO") {
                    setStatus("done");
                    setMessage(`"${data.title}" ya está publicada.`);
                    onPublished?.();
                    return;
                }

                if (data.status === "FALLIDO") {
                    setStatus("error");
                    setMessage("El procesamiento del audio falló.");
                    return;
                }
            } catch {
                // Error de red puntual: se reintenta en el próximo ciclo.
            }

            if (attempt + 1 >= MAX_POLLS) {
                setStatus("error");
                setMessage("El procesamiento está tardando demasiado. Revisá el catálogo más tarde.");
                return;
            }

            pollStatus(songId, attempt + 1);
        }, POLL_MS);
    }

    async function handleSubmit(event) {

        event.preventDefault();
        setMessage("");

        if (!file || !file.name.toLowerCase().endsWith(".wav")) {
            setStatus("error");
            setMessage("Elegí un archivo .wav.");
            return;
        }

        const artistId = getUserIdFromToken();
        if (!artistId) {
            setStatus("error");
            setMessage("No se pudo leer tu usuario. Volvé a iniciar sesión.");
            return;
        }

        const form = new FormData();
        form.append("title", title.trim());
        form.append("artist_id", artistId);
        form.append("file", file);

        setStatus("uploading");
        setProgress(0);

        try {
            const { data } = await api.post("/catalog/songs/upload", form, {
                onUploadProgress: (e) => {
                    if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            setStatus("processing");
            setMessage("Subida completa. Procesando audio...");
            setTitle("");
            autoTitle.current = "";
            setFile(null);
            if (fileInput.current) fileInput.current.value = "";

            pollStatus(data.song_id);

        } catch (err) {
            setStatus("error");
            setMessage(err.response?.data?.detail || "No se pudo subir la canción.");
        }
    }

    const busy = status === "uploading" || status === "processing";

    return (
        <form
            onSubmit={handleSubmit}
            className="border rounded p-4 mb-8 space-y-3 max-w-xl"
        >
            <h2 className="text-xl font-semibold">
                Subir canción
            </h2>

            <input
                type="text"
                placeholder="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border p-2"
                required
                disabled={busy}
            />

            <input
                ref={fileInput}
                type="file"
                accept=".wav,audio/wav"
                onChange={(e) => {
                    const picked = e.target.files[0] || null;
                    setFile(picked);
                    // Se completa con el nombre del archivo, salvo que el título ya se haya escrito a mano.
                    if (picked && (!title.trim() || title === autoTitle.current)) {
                        autoTitle.current = titleFromFileName(picked.name);
                        setTitle(autoTitle.current);
                    }
                }}
                className="w-full"
                required
                disabled={busy}
            />

            {status === "uploading" && (
                <div className="w-full bg-gray-200 rounded h-2">
                    <div
                        className="bg-blue-500 h-2 rounded"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}

            {message && (
                <p className={status === "error" ? "text-red-500" : status === "done" ? "text-green-600" : ""}>
                    {message}
                </p>
            )}

            <button
                type="submit"
                disabled={busy}
                className="border p-2 px-4 disabled:opacity-50"
            >
                {status === "uploading"
                    ? `Subiendo ${progress}%`
                    : status === "processing"
                        ? "Procesando..."
                        : "Subir"}
            </button>
        </form>
    );
}
