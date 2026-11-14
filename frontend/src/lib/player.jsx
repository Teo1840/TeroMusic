import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { hasValidToken } from "./auth";
import { PLAY_EVENT, usePlayTracking, useSignedStreamUrl } from "./audio";
import { pickRandom } from "./shuffle";

/**
 * Reproductor de la sesión para las canciones del catálogo. Vive por encima de las páginas
 * (ver main.jsx), así la canción sigue sonando al salir del catálogo. Las tarjetas
 * (AudioPlayer con `song`) y la barra de abajo (NowPlayingBar) solo muestran y mandan comandos.
 *
 * - play(song, { at, queue }): arranca esa canción (o la retoma si ya es la actual) desde `at`
 *   segundos. `queue` son las canciones de la lista donde se tocó (foto de ese momento).
 * - toggle(), seek(seconds), stop().
 * - Aleatorio: toggleShuffle(); con él prendido, al terminar una canción sigue otra de la cola
 *   al azar sin repetir hasta escucharlas todas. next() salta a la siguiente.
 */

// Nombre de este reproductor en PLAY_EVENT.
export const NOW_PLAYING = "now-playing";

const VOLUME_KEY = "player_volume";
const SHUFFLE_KEY = "player_shuffle";

function savedShuffle() {
    try {
        return localStorage.getItem(SHUFFLE_KEY) === "1";
    } catch {
        return false;
    }
}

function saveShuffle(on) {
    try {
        localStorage.setItem(SHUFFLE_KEY, on ? "1" : "0");
    } catch {
        // Sin almacenamiento vale solo para esta página.
    }
}

/** Volumen guardado (0 a 1); lo comparten todos los reproductores. */
export function savedVolume() {
    try {
        const value = Number(localStorage.getItem(VOLUME_KEY));
        return localStorage.getItem(VOLUME_KEY) !== null && value >= 0 && value <= 1 ? value : 1;
    } catch {
        return 1;
    }
}

export function saveVolume(volume) {
    try {
        localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
        // Sin almacenamiento el volumen vale solo para esta página.
    }
}

const PlayerContext = createContext(null);

export function usePlayer() {
    return useContext(PlayerContext);
}

export function PlayerProvider({ children }) {

    // Canción actual: { id, title, artist_name, artist_id, duration } o null.
    const [song, setSong] = useState(null);
    const songId = song?.id || null;
    const songIdRef = useRef(songId);
    songIdRef.current = songId;

    const audioRef = useRef(null);
    const { src, onError, onLoadedData } = useSignedStreamUrl(songId, audioRef);
    const tracking = usePlayTracking(songId, audioRef);

    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(savedVolume);
    const [muted, setMuted] = useState(false);
    const [notice, setNotice] = useState("");
    const [shuffle, setShuffle] = useState(savedShuffle);
    const [queueSize, setQueueSize] = useState(0);

    // Al llegar la URL de una canción nueva: desde dónde arrancar.
    const startAt = useRef(0);

    // Cola de la lista donde se tocó Reproducir y las ya escuchadas en esta vuelta del aleatorio.
    const queueRef = useRef([]);
    const playedRef = useRef(new Set());

    const tryPlay = useCallback(() => {
        audioRef.current?.play().catch(() => {
            setNotice("No se pudo iniciar el audio automáticamente. Tocá Reproducir para continuar.");
        });
    }, []);

    const play = useCallback((next, { at = 0, queue } = {}) => {
        if (!next?.id) return;
        setNotice("");
        if (queue) {
            const list = queue.some((s) => s.id === next.id) ? queue : [next, ...queue];
            queueRef.current = list;
            playedRef.current = new Set();
            setQueueSize(list.length);
        } else if (!queueRef.current.some((s) => s.id === next.id)) {
            queueRef.current = [next];
            playedRef.current = new Set();
            setQueueSize(1);
        }
        playedRef.current.add(next.id);
        if (next.id === songIdRef.current) {
            // Ya es la actual: si todavía carga, arranca sola al llegar la URL.
            if (!audioRef.current?.src) return;
            if (at) audioRef.current.currentTime = at;
            tryPlay();
            return;
        }
        audioRef.current?.pause();
        startAt.current = at;
        setSong(next);
        setPlaying(false);
        setCurrent(at);
        setDuration(Number.isFinite(next.duration) ? next.duration : 0);
    }, [tryPlay]);

    const toggle = useCallback(() => {
        const audio = audioRef.current;
        if (!audio?.src) return;
        if (audio.paused) tryPlay();
        else audio.pause();
    }, [tryPlay]);

    const seek = useCallback((seconds) => {
        if (!audioRef.current?.src) return;
        audioRef.current.currentTime = seconds;
        setCurrent(seconds);
    }, []);

    const stop = useCallback(() => {
        audioRef.current?.pause();
        setSong(null);
        setPlaying(false);
        setCurrent(0);
        setNotice("");
        queueRef.current = [];
        playedRef.current = new Set();
        setQueueSize(0);
    }, []);

    // Otra canción de la cola al azar, sin repetir hasta escucharlas todas.
    const next = useCallback(() => {
        const others = queueRef.current.filter((s) => s.id !== songIdRef.current);
        if (!others.length) return;
        let pending = others.filter((s) => !playedRef.current.has(s.id));
        if (!pending.length) {
            playedRef.current = new Set([songIdRef.current]);
            pending = others;
        }
        play(pickRandom(pending));
    }, [play]);

    const toggleShuffle = useCallback(() => {
        setShuffle((on) => {
            saveShuffle(!on);
            return !on;
        });
    }, []);

    // Llegó la URL firmada de la canción elegida: se ubica y arranca.
    useEffect(() => {
        const audio = audioRef.current;
        if (!src || !audio) return;
        if (startAt.current) audio.currentTime = startAt.current;
        startAt.current = 0;
        tryPlay();
    }, [src, tryPlay]);

    useEffect(() => {
        if (!audioRef.current) return;
        audioRef.current.volume = volume;
        audioRef.current.muted = muted;
    }, [volume, muted, src]);

    useEffect(() => {
        saveVolume(volume);
    }, [volume]);

    // Si arranca otro reproductor (la sala, una playlist), este se pausa.
    useEffect(() => {
        const onOtherPlay = (e) => {
            if (e.detail !== NOW_PLAYING) audioRef.current?.pause();
        };
        window.addEventListener(PLAY_EVENT, onOtherPlay);
        return () => window.removeEventListener(PLAY_EVENT, onOtherPlay);
    }, []);

    // Al cerrar sesión (o si vence el token) se corta.
    const { pathname } = useLocation();
    useEffect(() => {
        if (songId && !hasValidToken()) stop();
    }, [pathname, songId, stop]);

    const value = {
        song,
        src,
        playing,
        current,
        duration,
        volume,
        setVolume,
        muted,
        setMuted,
        notice,
        play,
        toggle,
        seek,
        stop,
        shuffle,
        toggleShuffle,
        next,
        hasNext: queueSize > 1
    };

    return (
        <PlayerContext.Provider value={value}>
            {children}
            <audio
                ref={audioRef}
                src={src || undefined}
                preload="auto"
                onError={src ? onError : undefined}
                onLoadedData={onLoadedData}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => {
                    if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
                }}
                onPlay={() => {
                    setNotice("");
                    tracking.onPlay();
                    setPlaying(true);
                    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: NOW_PLAYING }));
                }}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => {
                    tracking.onTimeUpdate();
                    setCurrent(e.currentTarget.currentTime);
                }}
                onSeeked={tracking.onSeeked}
                onEnded={() => {
                    tracking.onEnded();
                    setPlaying(false);
                    if (shuffle) next();
                }}
            />
        </PlayerContext.Provider>
    );
}
