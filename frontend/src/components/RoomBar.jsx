import { Link, useLocation } from "react-router-dom";
import { useRoomSession } from "../lib/roomSession";
import { PauseIcon, PlayIcon, PlaybackIcon, VolumeIcon, VolumeOffIcon } from "./Icons";

/**
 * Barra fija abajo mientras estás en una sala y navegás por otra página:
 * qué suena, volver a la sala, silenciar o salir. Quien controla la música también puede pausar.
 */
export default function RoomBar() {

    const session = useRoomSession();
    const { pathname } = useLocation();

    if (!session?.roomId) return null;
    const roomPath = `/rooms/${session.roomId}`;
    if (pathname === roomPath) return null;

    const {
        state, status, fatal, send, leave, canControl, localPaused, resume, blocked, unlockAudio, muted, setMuted
    } = session;
    const playback = state?.playback;

    let detail = "Conectando...";
    if (status === "reconnecting") detail = "Reconectando...";
    else if (localPaused) detail = "Silenciada para vos";
    else if (playback?.title) detail = `${playback.playing ? "Sonando" : "En pausa"}: ${playback.title}`;
    else if (state) detail = "Todavía no hay música";

    return (
        <div className="sticky bottom-0 z-10 border-t border-black bg-white" role="region" aria-label="Sala en vivo">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-8 py-2">

                {fatal ? (
                    <>
                        <p className="flex-1 min-w-0 text-sm" role="status">{fatal}</p>
                        <button onClick={leave} className="btn py-1 text-sm">Cerrar</button>
                    </>
                ) : (
                    <>
                        <Link to={roomPath} className="flex-1 min-w-0 text-sm hover:underline">
                            <span className="block truncate font-semibold">
                                {playback?.song_id && !localPaused && <><PlaybackIcon playing={playback.playing} />{" "}</>}
                                En vivo · {state?.room.name ?? "Sala"}
                            </span>
                            <span className="block truncate muted">{detail}</span>
                        </Link>

                        {canControl && playback?.song_id && (
                            <button
                                onClick={() => send({ type: playback.playing ? "pause" : "play" })}
                                aria-label={playback.playing ? "Pausar la sala" : "Reanudar la sala"}
                                title={playback.playing ? "Pausar la sala" : "Reanudar la sala"}
                                className="btn-icon"
                            >
                                {playback.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                            </button>
                        )}

                        {localPaused ? (
                            <button onClick={resume} className="btn-primary py-1 text-sm">
                                <VolumeIcon /> Volver a escuchar
                            </button>
                        ) : blocked ? (
                            <button onClick={unlockAudio} className="btn-primary py-1 text-sm">
                                <VolumeIcon /> Activar audio
                            </button>
                        ) : (
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
                        )}

                        <Link to={roomPath} className="btn py-1 text-sm">Ir a la sala</Link>
                        <button onClick={leave} className="btn py-1 text-sm">Salir</button>
                    </>
                )}
            </div>
        </div>
    );
}
