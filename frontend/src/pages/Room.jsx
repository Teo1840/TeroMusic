import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { PauseIcon, PlayIcon, PlaybackIcon, VolumeIcon } from "../components/Icons";
import { usePlayTracking, useSignedStreamUrl } from "../lib/audio";
import { positionAt, useRoom } from "../lib/room";

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

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function setRate(audio, rate) {
    if (audio.playbackRate !== rate) audio.playbackRate = rate;
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function roleOf(room, userId) {
    if (!room || !userId) return "listener";
    if (room.host_id === userId) return "host";
    if (room.cohosts.includes(userId)) return "cohost";
    return "listener";
}

const ROLE_LABEL = { host: "Anfitrión", cohost: "Coanfitrión", listener: "Oyente" };

export default function Room() {

    const { roomId } = useParams();
    const navigate = useNavigate();

    const { state, me, status, error, fatal, send, serverNow } = useRoom(roomId);
    const playback = state?.playback;
    const songId = playback?.song_id || null;

    const audioRef = useRef(null);
    const { src, onError, onLoadedData } = useSignedStreamUrl(songId, audioRef);
    const tracking = usePlayTracking(songId, audioRef, { roomId });

    const [blocked, setBlocked] = useState(false);   // el navegador bloqueó el autoplay
    const [volume, setVolume] = useState(1);
    const [clockNow, setClockNow] = useState(0);     // para redibujar la barra de progreso
    const [dragSec, setDragSec] = useState(null);    // posición mientras se arrastra la barra
    const [songs, setSongs] = useState([]);
    const [copied, setCopied] = useState(false);

    const role = roleOf(state?.room, me?.user_id);
    const canControl = role === "host" || role === "cohost";

    // El bucle de sincronización lee siempre el estado más nuevo.
    const playbackRef = useRef(playback);
    playbackRef.current = playback;

    // Estado del corrector: mediciones recientes, si está corrigiendo y hasta cuándo esperar.
    const sync = useRef({ samples: [], correcting: false, settleUntil: 0 });
    const [driftMs, setDriftMs] = useState(null);

    useEffect(() => {
        const settle = () => {
            sync.current = { samples: [], correcting: false, settleUntil: performance.now() + SETTLE_MS };
        };

        const timer = setInterval(() => {
            const now = serverNow();
            setClockNow(now);

            const audio = audioRef.current;
            const pb = playbackRef.current;
            if (!audio || !pb?.song_id || audio.readyState < 1) return;
            audio.preservesPitch = true;

            const expected = positionAt(pb, now) / 1000;
            const duration = pb.duration_sec || audio.duration || Infinity;
            // Al cambiar de canción hay un margen (updated_at en el futuro) para que todos carguen.
            const shouldPlay = pb.playing && now >= pb.updated_at_ms && expected < duration - 0.25;

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
                audio.play()
                    .then(() => {
                        setBlocked(false);
                        settle();
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

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume;
    }, [volume, src]);

    // Canciones para elegir (solo quien controla la música).
    useEffect(() => {
        if (!canControl) return;
        api.get("/catalog/songs").then(({ data }) => setSongs(data)).catch(() => {});
    }, [canControl]);

    function unlockAudio() {
        audioRef.current?.play().then(() => setBlocked(false)).catch(() => {});
    }

    function commitSeek() {
        if (dragSec === null) return;
        send({ type: "seek", position_ms: Math.round(dragSec * 1000) });
        setDragSec(null);
    }

    async function closeRoom() {
        if (!window.confirm("¿Cerrar la sala para todos?")) return;
        await api.delete(`/rooms/${roomId}`).catch(() => {});
        navigate("/rooms");
    }

    function copyLink() {
        navigator.clipboard?.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (fatal) {
        return (
            <div className="p-8">
                <p className="text-xl mb-4">{fatal}</p>
                <Link to="/rooms" className="underline text-blue-600">Volver a las salas</Link>
            </div>
        );
    }

    if (!state) {
        return <p className="p-8">Conectando con la sala...</p>;
    }

    const { room, listeners } = state;
    const durationSec = playback.duration_sec || audioRef.current?.duration || 0;
    const positionSec = dragSec ?? positionAt(playback, clockNow || serverNow()) / 1000;
    const startingIn = playback.playing ? Math.ceil((playback.updated_at_ms - clockNow) / 1000) : 0;

    return (
        <div className="p-8 max-w-4xl">

            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h1 className="text-3xl font-bold">{room.name}</h1>
                <div className="flex gap-2">
                    <button onClick={copyLink} className="border px-3 py-1 rounded">
                        {copied ? "¡Link copiado!" : "Copiar link"}
                    </button>
                    {role === "host" && (
                        <button onClick={closeRoom} className="border border-red-500 text-red-600 px-3 py-1 rounded">
                            Cerrar sala
                        </button>
                    )}
                </div>
            </div>

            <p className="text-gray-600 mb-6">
                {room.visibility === "public" ? "Sala pública" : "Sala privada"} · Sos{" "}
                <strong>{ROLE_LABEL[role].toLowerCase()}</strong>
                {status === "reconnecting" && <span className="text-orange-600"> · Reconectando...</span>}
            </p>

            {error && <p className="text-red-500 mb-4">{error}</p>}

            <div className="border rounded p-4 mb-6 space-y-3">

                <p className="text-lg">
                    {playback.title
                        ? <><PlaybackIcon playing={playback.playing} /> <strong>{playback.title}</strong></>
                        : "Todavía no hay música."}
                    {startingIn > 0 && <span className="text-gray-500"> · arranca en {startingIn} s</span>}
                </p>

                {playback.playing && driftMs !== null && (
                    <p className="text-xs text-gray-500">
                        Sincronización: {Math.abs(driftMs) <= 150 ? "en sincronía" : "ajustando"} ({driftMs > 0 ? "+" : ""}{driftMs} ms)
                    </p>
                )}

                {songId && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm w-10 text-right">{formatTime(positionSec)}</span>
                        <input
                            type="range"
                            min={0}
                            max={durationSec || 1}
                            step={0.1}
                            value={Math.min(positionSec, durationSec || 1)}
                            disabled={!canControl}
                            onChange={(e) => setDragSec(Number(e.target.value))}
                            onPointerUp={commitSeek}
                            onKeyUp={commitSeek}
                            className="flex-1"
                        />
                        <span className="text-sm w-10">{formatTime(durationSec)}</span>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-4">
                    {canControl && songId && (
                        <button
                            onClick={() => send({ type: playback.playing ? "pause" : "play" })}
                            className="inline-flex items-center gap-2 bg-black text-white px-4 py-2 rounded"
                        >
                            {playback.playing
                                ? <><PauseIcon /> Pausa</>
                                : <><PlayIcon /> Play</>}
                        </button>
                    )}

                    <label className="flex items-center gap-2 text-sm">
                        <VolumeIcon /> Volumen
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={volume}
                            onChange={(e) => setVolume(Number(e.target.value))}
                        />
                    </label>

                    {blocked && (
                        <button
                            onClick={unlockAudio}
                            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded"
                        >
                            <VolumeIcon /> Activar audio
                        </button>
                    )}
                </div>

                {canControl && (
                    <label className="block text-sm">
                        Poner canción:{" "}
                        <select
                            value=""
                            onChange={(e) => e.target.value && send({ type: "set_song", song_id: e.target.value })}
                            className="border p-1"
                        >
                            <option value="">Elegir...</option>
                            {songs.map((song) => (
                                <option key={song.id} value={song.id}>{song.title}</option>
                            ))}
                        </select>
                    </label>
                )}

                {!canControl && (
                    <p className="text-sm text-gray-500">
                        La música la controlan el anfitrión y los coanfitriones.
                    </p>
                )}

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
            </div>

            <h2 className="text-xl font-semibold mb-2">
                Escuchando ({listeners.length} / {room.max_listeners})
            </h2>

            <ul className="space-y-2">
                {listeners.map((listener) => {
                    const listenerRole = roleOf(room, listener.user_id);
                    return (
                        <li key={listener.user_id} className="flex items-center gap-3 border rounded px-3 py-2">
                            <span className="flex-1">
                                {listener.name}
                                {listener.user_id === me?.user_id && " (vos)"}
                            </span>
                            {listenerRole !== "listener" && (
                                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                                    {ROLE_LABEL[listenerRole]}
                                </span>
                            )}
                            {role === "host" && listenerRole === "listener" && (
                                <button
                                    onClick={() => send({ type: "promote", user_id: listener.user_id })}
                                    className="text-sm underline"
                                >
                                    Hacer coanfitrión
                                </button>
                            )}
                            {role === "host" && listenerRole === "cohost" && (
                                <button
                                    onClick={() => send({ type: "demote", user_id: listener.user_id })}
                                    className="text-sm underline text-red-600"
                                >
                                    Quitar coanfitrión
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

        </div>
    );
}
