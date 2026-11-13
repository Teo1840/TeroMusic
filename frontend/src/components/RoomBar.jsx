import { Link, useLocation } from "react-router-dom";
import { isOver } from "../lib/room";
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
        state, status, fatal, send, leave, canControl, localPaused, resume, blocked, unlockAudio, muted, setMuted,
        clockNow, serverNow
    } = session;
    // Si la última canción terminó (y no hay más en la cola) queda en el estado en pausa
    // al final: en la barra se muestra como que no suena nada.
    const current = state?.playback;
    const playback = current && !isOver(current, clockNow || serverNow()) ? current : null;

    let detail = "Conectando...";
    if (status === "reconnecting") detail = "Reconectando...";
    else if (localPaused) detail = "Silenciada para vos";
    else if (playback?.title) detail = `${playback.playing ? "Sonando" : "En pausa"}: ${playback.title}`;
    else if (current?.song_id) detail = "No está sonando nada";
    else if (state) detail = "Todavía no hay música";

    // Altura fija y siempre pegada abajo de la ventana: no cambia con el contenido de la
    // página ni con los botones que se muestren. El espaciador evita que tape el final.
    return (
        <>
        <div className="h-16" aria-hidden="true" />
        <div className="fixed inset-x-0 bottom-0 z-10 h-16 border-t border-black bg-white" role="region" aria-label="Sala en vivo">
            <div className="flex h-full flex-nowrap items-center gap-2 sm:gap-3 px-4 md:px-8">

                {fatal ? (
                    <>
                        <p className="flex-1 min-w-0 truncate text-sm" role="status" title={fatal}>{fatal}</p>
                        <button onClick={leave} className="btn shrink-0 whitespace-nowrap py-1 text-sm">Cerrar</button>
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
                                className="btn-icon shrink-0"
                            >
                                {playback.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                            </button>
                        )}

                        {localPaused ? (
                            <button onClick={resume} className="btn-primary shrink-0 whitespace-nowrap px-2 sm:px-4 py-1 text-sm" aria-label="Volver a escuchar">
                                <VolumeIcon /> <span className="hidden sm:inline">Volver a escuchar</span>
                            </button>
                        ) : blocked ? (
                            <button onClick={unlockAudio} className="btn-primary shrink-0 whitespace-nowrap px-2 sm:px-4 py-1 text-sm" aria-label="Activar audio">
                                <VolumeIcon /> <span className="hidden sm:inline">Activar audio</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setMuted((m) => !m)}
                                aria-label={muted ? "Activar sonido" : "Silenciar"}
                                aria-pressed={muted}
                                title={muted ? "Activar sonido" : "Silenciar"}
                                className="btn-icon shrink-0"
                            >
                                {muted ? <VolumeOffIcon size={18} /> : <VolumeIcon size={18} />}
                            </button>
                        )}

                        {/* En pantallas chicas el nombre de la sala ya lleva a la sala. */}
                        <Link to={roomPath} className="btn hidden sm:inline-flex shrink-0 whitespace-nowrap py-1 text-sm">Ir a la sala</Link>
                        <button onClick={leave} className="btn shrink-0 whitespace-nowrap px-3 sm:px-4 py-1 text-sm">Salir</button>
                    </>
                )}
            </div>
        </div>
        </>
    );
}
