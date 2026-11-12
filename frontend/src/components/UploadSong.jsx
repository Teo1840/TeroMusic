import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { errorMessage } from "../lib/format";

const POLL_MS = 2000;
const MAX_POLLS = 90; // ~3 minutos esperando al worker

// Los mismos formatos que acepta catalog_service.
const ACCEPTED = [".wav", ".mp3"];

// "mi_cancion-final.wav" → "mi cancion final"
function titleFromFileName(name) {
    return name
        .replace(/\.[^.]+$/, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Subida de canciones. catalog_service responde enseguida (202) y el worker
 * procesa el audio aparte: acá se consulta el estado hasta que quede PUBLICADO.
 * El artista no se manda: el gateway lo saca del JWT.
 */
export default function UploadSong() {

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
                    return;
                }

                if (data.status === "FALLIDO") {
                    setStatus("error");
                    setMessage("No se pudo procesar el audio.");
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

    function pickFile(picked) {
        setFile(picked);
        // Se completa con el nombre del archivo, salvo que el título ya se haya escrito a mano.
        if (picked && (!title.trim() || title === autoTitle.current)) {
            autoTitle.current = titleFromFileName(picked.name);
            setTitle(autoTitle.current);
        }
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setMessage("");

        const name = file?.name.toLowerCase() || "";
        if (!ACCEPTED.some((ext) => name.endsWith(ext))) {
            setStatus("error");
            setMessage("Elegí un archivo .wav o .mp3.");
            return;
        }

        const form = new FormData();
        form.append("title", title.trim());
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
            setMessage(errorMessage(err, "No se pudo subir la canción."));
        }
    }

    const busy = status === "uploading" || status === "processing";

    return (
        <form onSubmit={handleSubmit} className="card space-y-3 max-w-xl">

            <h2 className="section-title">Subir canción</h2>

            <input
                type="text"
                placeholder="Título"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field"
                required
                disabled={busy}
            />

            <input
                ref={fileInput}
                type="file"
                accept={`${ACCEPTED.join(",")},audio/wav,audio/mpeg`}
                onChange={(e) => pickFile(e.target.files[0] || null)}
                className="w-full text-sm file:mr-3 file:border file:border-black file:bg-white file:px-3 file:py-1 hover:file:bg-black hover:file:text-white"
                required
                disabled={busy}
            />

            {status === "uploading" && (
                <div className="w-full h-2 border border-black" aria-hidden="true">
                    <div className="h-full bg-black" style={{ width: `${progress}%` }} />
                </div>
            )}

            {message && (
                <p className="notice" role={status === "error" ? "alert" : "status"}>
                    {message}
                    {status === "done" && <> <Link to="/catalog" className="link">Escucharla en el catálogo</Link></>}
                </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary">
                {status === "uploading"
                    ? `Subiendo ${progress}%`
                    : status === "processing"
                        ? "Procesando..."
                        : "Subir"}
            </button>
        </form>
    );
}
