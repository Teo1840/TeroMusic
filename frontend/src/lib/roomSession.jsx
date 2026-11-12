import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { hasValidToken } from "./auth";
import { PLAY_EVENT, usePlayTracking, useSignedStreamUrl } from "./audio";
import { positionAt, useRoom } from "./room";

/**
 * Sala en vivo de la sesión. Vive por encima de las páginas (ver main.jsx), así la
 * conexión y la música siguen al ir al catálogo u otra página. La página de la sala y la
 * barra de abajo (RoomBar) solo muestran y mandan comandos.
 *
 * - join(roomId): entra (o cambia) de sala. leave(): sale.
 * - Si suena un reproductor del catálogo, la sala se silencia para este usuario
 *   (localPaused) hasta que toque "Volver a escuchar" (resume). La sala sigue para los demás.
 */

// Sincronización (ver services/rooms_service/README.md, "Cómo se sincroniza").
// Más de esto de diferencia → salto directo a la posición correcta.
const HARD_DRIFT_SEC = 1;
// Se empieza a corregir con velocidad (±5 %) al pasar START y se deja al bajar de STOP.
// El margen entre los dos evita cambiar de velocidad todo el tiempo (eso hace que se trabe).
const SOFT_START_SEC = 0.15;
const SOFT_STOP_SEC = 0.03;
// Después de un salto o de arrancar, se espera a que el audio se acomode antes de medir.
const SETTLE_MS = 2000;
// Cantidad de mediciones para la mediana (en celulares currentTime es poco preciso).
const SAMPLES = 5;
// Nombre de este reproductor en PLAY_EVENT.
const ROOM_PLAYER = "room";

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function setRate(audio, rate) {
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
}

export function roleOf(room, userId) {
    if (!room || !userId) return "listener";
    if (room.host_id === userId) return "host";
    if (room.cohosts.includes(userId)) return "cohost";
    return "listener";
}

export const ROLE_LABEL = { host: "Anfitrión", cohost: "Coanfitrión", listener: "Oyente" };

const RoomContext = createContext(null);

export function useRoomSession() {
    return useContext(RoomContext);
}

export function RoomProvider({ children }) {

    const [roomId, setRoomId] = useState(null);
    const room = useRoom(roomId);
    const { state, me, send, serverNow } = room;
    const playback = state?.playback;
    const songId = playback?.song_id || null;

    const audioRef = useRef(null);
    const { src, onError, onLoadedData } = useSignedStreamUrl(songId, audioRef);
    const tracking = usePlayTracking(songId, audioRef, { roomId });

    const [blocked, setBlocked] = useState(false);       // el navegador bloqueó el autoplay
    const [localPaused, setLocalPaused] = useState(false);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [clockNow, setClockNow] = useState(0);         // para redibujar la barra de progreso
    const [driftMs, setDriftMs] = useState(null);

    const role = roleOf(state?.room, me?.user_id);
    const canControl = role === "host" || role === "cohost";

    // El bucle de sincronización lee siempre el estado más nuevo.
    const playbackRef = useRef(playback);
    playbackRef.current = playback;
    const sendRef = useRef(send);
    sendRef.current = send;
    const localPausedRef = useRef(localPaused);
    localPausedRef.current = localPaused;

    // Estado del corrector: mediciones recientes, si está corrigiendo y hasta cuándo esperar.
    const sync = useRef({ samples: [], correcting: false, settleUntil: 0 });
    // Último "terminó la canción" avisado, para no repetirlo.
    const endedSent = useRef("");

    const join = useCallback((id) => setRoomId(id), []);
    const leave = useCallback(() => setRoomId(null), []);

    const resume = useCallback(() => {
        localPausedRef.current = false;
        setLocalPaused(false);
    }, []);

    const unlockAudio = useCallback(() => {
        audioRef.current?.play().then(() => setBlocked(false)).catch(() => {});
    }, []);

    // Sala nueva: se escucha de nuevo y se mide desde cero.
    useEffect(() => {
        setLocalPaused(false);
        setBlocked(false);
        setDriftMs(null);
        endedSent.current = "";
    }, [roomId]);

    // Al cerrar sesión (o si vence el token) se sale de la sala.
    const { pathname } = useLocation();
    useEffect(() => {
        if (roomId && !hasValidToken()) setRoomId(null);
    }, [pathname, roomId]);

    // Si arranca un reproductor del catálogo, la sala se silencia para este usuario.
    useEffect(() => {
        const onOtherPlay = (e) => {
            if (e.detail === ROOM_PLAYER) return;
            localPausedRef.current = true;
            setLocalPaused(true);
            audioRef.current?.pause();
        };
        window.addEventListener(PLAY_EVENT, onOtherPlay);
        return () => window.removeEventListener(PLAY_EVENT, onOtherPlay);
    }, []);

    useEffect(() => {
        const settle = () => {
            sync.current = { samples: [], correcting: false, settleUntil: performance.now() + SETTLE_MS };
        };

        const timer = setInterval(() => {
            const pb = playbackRef.current;
            if (!pb) return;
            const now = serverNow();
            setClockNow(now);

            const audio = audioRef.current;
            if (!audio || !pb.song_id || audio.readyState < 1) return;
            audio.preservesPitch = true;

            const expected = positionAt(pb, now) / 1000;
            const duration = pb.duration_sec || audio.duration || Infinity;

            // Terminó según el reloj del servidor: se deja que el audio termine solo
            // (así cuenta como escuchada completa) y se avisa para que arranque la siguiente.
            // El servidor lo verifica y, si varios avisan a la vez, avanza una sola vez.
            if (pb.playing && expected >= duration - 0.05) {
                const key = `${pb.song_id}:${pb.updated_at_ms}`;
                if (endedSent.current !== key) {
                    endedSent.current = key;
                    sendRef.current({ type: "ended", song_id: pb.song_id, updated_at_ms: pb.updated_at_ms });
                }
                setDriftMs(null);
                return;
            }

            // Silenciada por este usuario: quieta, sin saltar (al volver se ubica sola).
            if (localPausedRef.current) {
                if (!audio.paused) audio.pause();
                setDriftMs(null);
                return;
            }

            // Al cambiar de canción hay un margen (updated_at en el futuro) para que todos carguen.
            const shouldPlay = pb.playing && now >= pb.updated_at_ms;

            // En pausa: quieto en la posición correcta.
            if (!shouldPlay) {
                if (!audio.paused) audio.pause();
                if (Math.abs(expected - audio.currentTime) > 0.1) audio.currentTime = expected;
                setRate(audio, 1);
                setDriftMs(null);
                return;
            }

            // Tiene que sonar y está quieto: se ubica y arranca.
            if (audio.paused) {
                if (Math.abs(expected - audio.currentTime) > 0.1) audio.currentTime = expected;
                // El archivo terminó un poco antes que la duración del catálogo: no volver a empezar.
                if (audio.ended) return;
                audio.play()
                    .then(() => {
                        setBlocked(false);
                        settle();
                        // Los reproductores del catálogo se pausan.
                        window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: ROOM_PLAYER }));
                    })
                    .catch((err) => {
                        if (err.name === "NotAllowedError") setBlocked(true);
                    });
                return;
            }

            // Sonando: no se mide mientras se acomoda, salta o carga.
            const s = sync.current;
            if (performance.now() < s.settleUntil || audio.seeking || audio.readyState < 3) return;

            s.samples.push(expected - audio.currentTime);
            if (s.samples.length > SAMPLES) s.samples.shift();
            if (s.samples.length < 3) return;

            const drift = median(s.samples);
            setDriftMs(Math.round(drift * 1000));

            if (Math.abs(drift) > HARD_DRIFT_SEC) {
                audio.currentTime = expected;
                setRate(audio, 1);
                settle();
                return;
            }

            if (!s.correcting && Math.abs(drift) > SOFT_START_SEC) s.correcting = true;
            if (s.correcting && Math.abs(drift) < SOFT_STOP_SEC) s.correcting = false;
            setRate(audio, s.correcting ? (drift > 0 ? 1.05 : 0.95) : 1);
        }, 250);
        return () => clearInterval(timer);
    }, [serverNow]);

    // Un cambio de canción o un salto del anfitrión: medir de nuevo desde cero.
    useEffect(() => {
        sync.current = { samples: [], correcting: false, settleUntil: performance.now() + SETTLE_MS };
    }, [playback?.song_id, playback?.updated_at_ms]);

    // Al cambiar de canción se redibuja ya con la hora actual, sin esperar al bucle.
    useEffect(() => {
        setClockNow(serverNow());
    }, [songId, serverNow]);

    useEffect(() => {
        if (!audioRef.current) return;
        audioRef.current.volume = volume;
        audioRef.current.muted = muted;
    }, [volume, muted, src]);

    const value = {
        ...room,
        roomId,
        join,
        leave,
        role,
        canControl,
        audioRef,
        src,
        blocked,
        unlockAudio,
        localPaused,
        resume,
        volume,
        setVolume,
        muted,
        setMuted,
        clockNow,
        driftMs
    };

    return (
        <RoomContext.Provider value={value}>
            {children}
            {src && (
                <audio
                    ref={audioRef}
                    src={src}
                    preload="auto"
                    onError={onError}
                    onLoadedData={onLoadedData}
                    {...tracking}
                />
            )}
        </RoomContext.Provider>
    );
}
