import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { NextIcon, PauseIcon, PlayIcon, PlaybackIcon, VolumeIcon, VolumeOffIcon } from "../components/Icons";
import RoomQueue from "../components/RoomQueue";
import SongSearch from "../components/SongSearch";
import { formatTime } from "../lib/format";
import { positionAt } from "../lib/room";
import { ROLE_LABEL, roleOf, useRoomSession } from "../lib/roomSession";

/**
 * Pantalla de la sala. La conexión y la música viven en RoomProvider (lib/roomSession.jsx):
 * al ir a otra página la sala sigue sonando y queda la barra de abajo (RoomBar).
 */
export default function Room() {

    const { roomId } = useParams();
    const navigate = useNavigate();

    const session = useRoomSession();
    const {
        state, me, status, error, fatal, send, serverNow, join, leave, role, canControl,
        audioRef, src, blocked, unlockAudio, localPaused, resume, volume, setVolume, muted, setMuted,
        clockNow, driftMs
    } = session;
    // Mientras se cambia de sala no se muestra la anterior.
    const current = session.roomId === roomId;
    const playback = current ? state?.playback : null;
    const songId = playback?.song_id || null;

    // Entrar a la sala del link (o cambiar a esta si estaba en otra).
    useEffect(() => {
        join(roomId);
    }, [roomId, join]);

    const [dragSec, setDragSec] = useState(null);    // posición mientras se arrastra la barra
    const [songs, setSongs] = useState([]);
    const [copied, setCopied] = useState(false);

    // Al cambiar de canción: soltar un arrastre que quedó colgado (p. ej. un toque
    // cancelado en el celular).
    useEffect(() => {
        setDragSec(null);
    }, [songId]);

    // Canciones del catálogo: para poner, agregar a la cola o sugerir.
    useEffect(() => {
        api.get("/catalog/songs").then(({ data }) => setSongs(data)).catch(() => {});
    }, []);

    function commitSeek() {
        if (dragSec === null) return;
        send({ type: "seek", position_ms: Math.round(dragSec * 1000) });
        setDragSec(null);
    }

    async function closeRoom() {
        if (!window.confirm("¿Cerrar la sala para todos?")) return;
        await api.delete(`/rooms/${roomId}`).catch(() => {});
        leave();
        navigate("/rooms");
    }

    function leaveRoom() {
        leave();
        navigate("/rooms");
    }

    function copyLink() {
        navigator.clipboard?.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (current && fatal) {
        return (
            <div className="page">
                <p className="text-xl mb-4">{fatal}</p>
                <Link to="/rooms" onClick={leave} className="link">Volver a las salas</Link>
            </div>
        );
    }

    if (!current || !state) {
        return <p className="page muted">Conectando con la sala...</p>;
    }

    const { room, listeners, queue, suggestions } = state;
    // Sin duración en el catálogo se usa la del archivo, solo si ya es el de esta canción.
    const fileDuration = src ? audioRef.current?.duration : NaN;
    const durationSec = playback.duration_sec || (Number.isFinite(fileDuration) ? fileDuration : 0);
    const rawPositionSec = dragSec ?? positionAt(playback, clockNow || serverNow()) / 1000;
    const positionSec = Math.max(0, durationSec ? Math.min(rawPositionSec, durationSec) : rawPositionSec);
    const startingIn = playback.playing ? Math.ceil((playback.updated_at_ms - clockNow) / 1000) : 0;

    return (
        <div className="page max-w-4xl">

            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <h1 className="page-title break-words min-w-0">{room.name}</h1>
                <div className="flex flex-wrap gap-2">
                    <button onClick={copyLink} className="btn py-1">
                        {copied ? "¡Link copiado!" : "Copiar link"}
                    </button>
                    <button onClick={leaveRoom} className="btn py-1">
                        Salir de la sala
                    </button>
                    {role === "host" && (
                        <button onClick={closeRoom} className="btn py-1">
                            Cerrar sala
                        </button>
                    )}
                </div>
            </div>

            <p className="muted mb-6">
                {room.visibility === "public" ? "Sala pública" : "Sala privada"} · Sos{" "}
                <strong>{ROLE_LABEL[role].toLowerCase()}</strong>
                {status === "reconnecting" && <strong> · Reconectando...</strong>}
            </p>

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            <div className="card mb-6 space-y-3">

                <p className="text-lg break-words">
                    {playback.title
                        ? <><PlaybackIcon playing={playback.playing} /> <strong>{playback.title}</strong></>
                        : "Todavía no hay música."}
                    {startingIn > 0 && <span className="muted"> · arranca en {startingIn} s</span>}
                </p>

                {playback.playing && driftMs !== null && (
                    <p className="text-xs muted">
                        Sincronización: {Math.abs(driftMs) <= 150 ? "en sincronía" : "ajustando"} ({driftMs > 0 ? "+" : ""}{driftMs} ms)
                    </p>
                )}

                {songId && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm w-10 text-right tabular-nums">{formatTime(positionSec)}</span>
                        <input
                            type="range"
                            min={0}
                            max={durationSec || 1}
                            step={0.1}
                            value={durationSec ? positionSec : 0}
                            disabled={!canControl}
                            onChange={(e) => setDragSec(Number(e.target.value))}
                            onPointerUp={commitSeek}
                            onPointerCancel={commitSeek}
                            onKeyUp={commitSeek}
                            onBlur={commitSeek}
                            className="flex-1 accent-black"
                        />
                        <span className="text-sm w-10 tabular-nums">{formatTime(durationSec)}</span>
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-4">
                    {canControl && songId && (
                        <button
                            onClick={() => send({ type: playback.playing ? "pause" : "play" })}
                            className="btn-primary"
                        >
                            {playback.playing
                                ? <><PauseIcon /> Pausa</>
                                : <><PlayIcon /> Play</>}
                        </button>
                    )}

                    {canControl && queue.length > 0 && (
                        <button
                            onClick={() => send({ type: "next" })}
                            className="btn"
                        >
                            <NextIcon /> Siguiente
                        </button>
                    )}

                    <div className="flex items-center gap-2 text-sm w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={() => setMuted((m) => !m)}
                            aria-label={muted ? "Activar sonido" : "Silenciar"}
                            aria-pressed={muted}
                            title={muted ? "Activar sonido" : "Silenciar"}
                            className="btn-icon"
                        >
                            {muted ? <VolumeOffIcon size={18} /> : <VolumeIcon size={18} />}
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={muted ? 0 : volume}
                            onChange={(e) => {
                                setVolume(Number(e.target.value));
                                setMuted(false);
                            }}
                            aria-label="Volumen"
                            className="flex-1 sm:flex-none accent-black"
                        />
                    </div>

                    {localPaused && (
                        <button onClick={resume} className="btn-primary">
                            <VolumeIcon /> Volver a escuchar la sala
                        </button>
                    )}

                    {blocked && !localPaused && (
                        <button
                            onClick={unlockAudio}
                            className="btn-primary"
                        >
                            <VolumeIcon /> Activar audio
                        </button>
                    )}
                </div>

                {canControl && (
                    <SongSearch
                        songs={songs}
                        icon={<PlayIcon />}
                        label="Poner ahora:"
                        actionIcon={<PlayIcon />}
                        onPick={(song) => send({ type: "set_song", song_id: song.id })}
                    />
                )}

                {!canControl && (
                    <p className="text-sm muted">
                        La música la controlan el anfitrión y los coanfitriones.
                    </p>
                )}

                {localPaused && (
                    <p className="text-sm muted">
                        Pusiste una canción del catálogo: la sala sigue para los demás, pero vos no la escuchás.
                    </p>
                )}

            </div>

            <RoomQueue
                queue={queue}
                suggestions={suggestions}
                songs={songs}
                canControl={canControl}
                me={me}
                send={send}
            />

            <h2 className="section-title mb-2">
                Escuchando ({listeners.length} / {room.max_listeners})
            </h2>

            <ul className="space-y-2">
                {listeners.map((listener) => {
                    const listenerRole = roleOf(room, listener.user_id);
                    return (
                        <li key={listener.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-black px-3 py-2">
                            <span className="flex-1 min-w-0 break-words">
                                {listener.name}
                                {listener.user_id === me?.user_id && " (vos)"}
                            </span>
                            {listenerRole !== "listener" && (
                                <span className="text-xs bg-black text-white px-2 py-0.5">
                                    {ROLE_LABEL[listenerRole]}
                                </span>
                            )}
                            {role === "host" && listenerRole === "listener" && (
                                <button
                                    onClick={() => send({ type: "promote", user_id: listener.user_id })}
                                    className="text-sm link py-1"
                                >
                                    Hacer coanfitrión
                                </button>
                            )}
                            {role === "host" && listenerRole === "cohost" && (
                                <button
                                    onClick={() => send({ type: "demote", user_id: listener.user_id })}
                                    className="text-sm link py-1"
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
