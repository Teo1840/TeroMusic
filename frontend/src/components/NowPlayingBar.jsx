import { useLocation } from "react-router-dom";
import { formatTime } from "../lib/format";
import { usePlayer } from "../lib/player";
import { useRoomSession } from "../lib/roomSession";
import ArtistLink from "./ArtistLink";
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, ShuffleIcon } from "./Icons";

/**
 * Barra fija abajo con la canción del catálogo que está sonando: sigue al cambiar de página.
 * Si también está la barra de la sala (RoomBar), queda justo encima de ella.
 */
export default function NowPlayingBar() {

    const player = usePlayer();
    const room = useRoomSession();
    const { pathname } = useLocation();

    if (!player?.song) return null;

    const { song, src, playing, current, duration, notice, toggle, stop, shuffle, toggleShuffle, next, hasNext } = player;
    const roomBarShown = Boolean(room?.roomId) && pathname !== `/rooms/${room.roomId}`;
    const progress = duration > 0 ? Math.min(current / duration, 1) : 0;

    const detail = !src ? "Cargando audio..." : "Tocá Reproducir para continuar";

    return (
        <>
        <div className={roomBarShown ? "h-16" : "h-[calc(4rem+env(safe-area-inset-bottom))]"} aria-hidden="true" />
        <div
            className={`fixed inset-x-0 z-20 border-t border-black bg-white ${roomBarShown ? "bottom-[calc(4rem+env(safe-area-inset-bottom))]" : "bottom-0 pb-[env(safe-area-inset-bottom)]"}`}
            role="region"
            aria-label="Sonando ahora"
        >
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gray-200" aria-hidden="true">
                <div className="h-full bg-black" style={{ width: `${progress * 100}%` }} />
            </div>

            <div className="mx-auto flex h-16 max-w-6xl flex-nowrap items-center gap-2 sm:gap-3 px-4 sm:px-6 lg:px-8">
                <button
                    type="button"
                    onClick={toggle}
                    disabled={!src}
                    aria-label={playing ? "Pausar" : "Reproducir"}
                    title={playing ? "Pausar" : "Reproducir"}
                    className="btn-primary shrink-0 p-2"
                >
                    {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                </button>

                <div className="flex-1 min-w-0 text-sm">
                    <p className="truncate font-semibold" aria-live="polite">{song.title}</p>
                    {src && !notice ? (
                        <ArtistLink song={song} className="block truncate muted" />
                    ) : (
                        <p className="truncate muted">{detail}</p>
                    )}
                </div>

                <span className="hidden sm:inline shrink-0 text-xs muted tabular-nums">
                    {formatTime(current)} / {formatTime(duration)}
                </span>

                <button
                    type="button"
                    onClick={toggleShuffle}
                    aria-label="Aleatorio"
                    aria-pressed={shuffle}
                    title={shuffle ? "Aleatorio: activado" : "Aleatorio: desactivado"}
                    className={`btn-icon shrink-0 ${shuffle ? "bg-black text-white" : ""}`}
                >
                    <ShuffleIcon size={18} />
                </button>

                {shuffle && hasNext && (
                    <button
                        type="button"
                        onClick={next}
                        aria-label="Siguiente"
                        title="Siguiente"
                        className="btn-icon shrink-0"
                    >
                        <NextIcon size={18} />
                    </button>
                )}

                <button
                    type="button"
                    onClick={stop}
                    aria-label="Cerrar reproductor"
                    title="Cerrar reproductor"
                    className="btn-icon shrink-0"
                >
                    <CloseIcon size={18} />
                </button>
            </div>
        </div>
        </>
    );
}
