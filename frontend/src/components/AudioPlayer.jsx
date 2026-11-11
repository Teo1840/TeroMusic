import { useEffect, useRef, useState } from "react";
import api from "../api/client";

// Saltos de tiempo mayores a esto son seeks, no reproducción: no se cuentan.
const MAX_TICK_SEC = 1.5;

/**
 * Registra la reproducción en audio_service (POST /audio/played → song.played.v1).
 * Usa fetch con keepalive para que el aviso salga aunque se cierre la pestaña.
 */
function reportPlayed(body) {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    fetch("/api/v1/audio/played", {
        method: "POST",
        keepalive: true,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
    }).catch(() => {
        // Las métricas no deben romper el reproductor.
    });
}

export default function AudioPlayer({ songId }) {

    const audioRef = useRef(null);

    // URL temporal firmada (vence): <audio> no puede mandar el token en un header.
    const [src, setSrc] = useState(null);
    const retried = useRef(false);

    const loadUrl = async () => {
        const { data } = await api.get(`/audio/stream-url/${songId}`);
        setSrc(data.url);
    };

    useEffect(() => {
        retried.current = false;
        setSrc(null);
        loadUrl().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songId]);

    // Si la URL venció mientras la página estaba abierta, se pide una nueva (una vez).
    const handleError = () => {
        if (retried.current) return;
        retried.current = true;
        const audio = audioRef.current;
        const position = audio?.currentTime || 0;
        loadUrl()
            .then(() => {
                if (audioRef.current) audioRef.current.currentTime = position;
            })
            .catch(() => {});
    };

    // Reproducción en curso: { startedAt, listened, lastTime } o null.
    const session = useRef(null);

    // Manda el evento una sola vez por reproducción y la cierra.
    const flush = (completed) => {
        const s = session.current;
        session.current = null;
        if (!s || s.listened < 1) return;

        reportPlayed({
            song_id: songId,
            started_at: s.startedAt,
            listened_sec: Math.round(s.listened * 10) / 10,
            completed,
            client: "web"
        });
    };

    const handlePlay = () => {
        if (!session.current) {
            session.current = {
                startedAt: new Date().toISOString(),
                listened: 0,
                lastTime: audioRef.current.currentTime
            };
        } else {
            session.current.lastTime = audioRef.current.currentTime;
        }
    };

    const handleTimeUpdate = () => {
        const s = session.current;
        const audio = audioRef.current;
        if (!s || audio.paused) return;

        const delta = audio.currentTime - s.lastTime;
        if (delta > 0 && delta <= MAX_TICK_SEC) s.listened += delta;
        s.lastTime = audio.currentTime;
    };

    const handleSeeked = () => {
        if (session.current) session.current.lastTime = audioRef.current.currentTime;
    };

    // Abandono: cambiar de canción, salir de la página o cerrar la pestaña.
    useEffect(() => {
        const onPageHide = () => flush(false);
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            flush(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songId]);

    if (!src) {
        return <p className="text-sm text-gray-500">Cargando audio...</p>;
    }

    return (
        <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={src}
            onError={handleError}
            onLoadedData={() => { retried.current = false; }}
            onPlay={handlePlay}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleSeeked}
            onEnded={() => flush(true)}
        />
    );
}
