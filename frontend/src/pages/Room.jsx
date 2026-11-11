import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { usePlayTracking, useSignedStreamUrl } from "../lib/audio";
import { positionAt, useRoom } from "../lib/room";

// Sincronización: más de esto de diferencia → salto directo a la posición correcta.
const HARD_DRIFT_SEC = 0.5;
// Entre SOFT y HARD: se acelera o frena un 5 % hasta alcanzar (no se nota al oído).
const SOFT_DRIFT_SEC = 0.05;

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

    useEffect(() => {
        const timer = setInterval(() => {
            const now = serverNow();
            setClockNow(now);

            const audio = audioRef.current;
            const pb = playbackRef.current;
            if (!audio || !pb?.song_id || audio.readyState < 1) return;

            const expected = positionAt(pb, now) / 1000;
            const duration = pb.duration_sec || audio.duration || Infinity;
            // Al cambiar de canción hay un margen (updated_at en el futuro) para que todos carguen.
            const shouldPlay = pb.playing && now >= pb.updated_at_ms && expected < duration - 0.25;
            const drift = expected - audio.currentTime;

            if (Math.abs(drift) > (shouldPlay ? HARD_DRIFT_SEC : 0.1)) {
                audio.currentTime = expected;
                audio.playbackRate = 1;
            } else if (shouldPlay && Math.abs(drift) > SOFT_DRIFT_SEC) {
                audio.playbackRate = drift > 0 ? 1.05 : 0.95;
            } else {
                audio.playbackRate = 1;
            }

            if (shouldPlay && audio.paused) {
                audio.play()
                    .then(() => setBlocked(false))
                    .catch((err) => {
                        if (err.name === "NotAllowedError") setBlocked(true);
                    });
            } else if (!shouldPlay && !audio.paused) {
                audio.pause();
            }
        }, 250);
        return () => clearInterval(timer);
    }, [serverNow]);

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
                        ? <>{playback.playing ? "▶" : "⏸"} <strong>{playback.title}</strong></>
                        : "Todavía no hay música."}
                    {startingIn > 0 && <span className="text-gray-500"> · arranca en {startingIn} s</span>}
                </p>

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
                            className="bg-black text-white px-4 py-2 rounded"
                        >
                            {playback.playing ? "Pausa" : "Play"}
                        </button>
                    )}

                    <label className="flex items-center gap-2 text-sm">
                        Volumen
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
                        <button onClick={unlockAudio} className="bg-orange-500 text-white px-4 py-2 rounded">
                            🔊 Activar audio
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
