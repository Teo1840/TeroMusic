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

/**
 * URL temporal firmada del stream (vence): <audio> no puede mandar el token en un header.
 * Si vence con la página abierta, onError pide una nueva una vez y vuelve a la misma posición.
 */
export function useSignedStreamUrl(songId, audioRef) {

    const [src, setSrc] = useState(null);
    const retried = useRef(false);

    const loadUrl = async () => {
        const { data } = await api.get(`/audio/stream-url/${songId}`);
        setSrc(data.url);
    };

    useEffect(() => {
        retried.current = false;
        setSrc(null);
        if (songId) loadUrl().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songId]);

    const onError = () => {
        if (retried.current || !songId) return;
        retried.current = true;
        const position = audioRef.current?.currentTime || 0;
        loadUrl()
            .then(() => {
                if (audioRef.current) audioRef.current.currentTime = position;
            })
            .catch(() => {});
    };

    const onLoadedData = () => {
        retried.current = false;
    };

    return { src, onError, onLoadedData };
}

/**
 * Cuenta los segundos escuchados de verdad (sin saltos) y manda un aviso por reproducción:
 * al terminar (completed: true) o al abandonar (cambiar de canción, salir o cerrar la pestaña).
 * Menos de 1 segundo no cuenta. Devuelve los handlers para el <audio>.
 */
export function usePlayTracking(songId, audioRef, { roomId } = {}) {

    // Reproducción en curso: { startedAt, listened, lastTime } o null.
    const session = useRef(null);

    const flush = (completed, id = songId) => {
        const s = session.current;
        session.current = null;
        if (!s || s.listened < 1 || !id) return;

        const body = {
            song_id: id,
            started_at: s.startedAt,
            listened_sec: Math.round(s.listened * 10) / 10,
            completed,
            client: "web"
        };
        if (roomId) body.room_id = roomId;
        reportPlayed(body);
    };

    useEffect(() => {
        const id = songId;
        const onPageHide = () => flush(false, id);
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            flush(false, id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [songId]);

    return {
        onPlay: () => {
            const audio = audioRef.current;
            if (!session.current) {
                session.current = {
                    startedAt: new Date().toISOString(),
                    listened: 0,
                    lastTime: audio.currentTime
                };
            } else {
                session.current.lastTime = audio.currentTime;
            }
        },
        onTimeUpdate: () => {
            const s = session.current;
            const audio = audioRef.current;
            if (!s || audio.paused) return;

            const delta = audio.currentTime - s.lastTime;
            if (delta > 0 && delta <= MAX_TICK_SEC) s.listened += delta;
            s.lastTime = audio.currentTime;
        },
        onSeeked: () => {
            if (session.current) session.current.lastTime = audioRef.current.currentTime;
        },
        onEnded: () => flush(true)
    };
}
