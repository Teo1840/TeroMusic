import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import { usePlayTracking, useSignedStreamUrl } from "../lib/audio";
import { formatTime } from "../lib/format";
import { PauseIcon, PlayIcon, VolumeIcon, VolumeOffIcon } from "./Icons";

const VOLUME_KEY = "player_volume";
// Aviso entre reproductores: al dar play en uno, los demás se pausan.
const PLAY_EVENT = "teromusic:play";

function savedVolume() {
    try {
        const value = Number(localStorage.getItem(VOLUME_KEY));
        return localStorage.getItem(VOLUME_KEY) !== null && value >= 0 && value <= 1 ? value : 1;
    } catch {
        return 1;
    }
}

/** Picos de la canción (GET /audio/waveform/{id}) o null si no tiene: se muestra una barra simple. */
function useWaveform(songId) {
    const [waveform, setWaveform] = useState({ songId: null, peaks: null });

    useEffect(() => {
        let cancelled = false;
        api.get(`/audio/waveform/${songId}`)
            .then(({ data }) => {
                if (!cancelled) setWaveform({ songId, peaks: Array.isArray(data.peaks) ? data.peaks : null });
            })
            .catch(() => {
                if (!cancelled) setWaveform({ songId, peaks: null });
            });
        return () => {
            cancelled = true;
        };
    }, [songId]);

    return waveform.songId === songId ? waveform.peaks : null;
}

/**
 * Barra de progreso con la forma de onda. Se puede tocar o arrastrar para adelantar,
 * y con el teclado: flechas (±5 s), Inicio y Fin.
 */
function WaveformBar({ peaks, current, duration, onSeek }) {
    const barRef = useRef(null);
    const dragging = useRef(false);
    const progress = duration > 0 ? Math.min(current / duration, 1) : 0;

    const seekAt = (clientX) => {
        const rect = barRef.current.getBoundingClientRect();
        const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
        onSeek(ratio * duration);
    };

    const onKeyDown = (e) => {
        const keys = {
            ArrowLeft: current - 5,
            ArrowDown: current - 5,
            ArrowRight: current + 5,
            ArrowUp: current + 5,
            Home: 0,
            End: duration
        };
        if (!(e.key in keys) || !duration) return;
        e.preventDefault();
        onSeek(Math.min(Math.max(keys[e.key], 0), duration));
    };

    return (
        <div
            ref={barRef}
            role="slider"
            tabIndex={duration ? 0 : -1}
            aria-label="Posición de la canción"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration) || 0}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${formatTime(current)} de ${formatTime(duration)}`}
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
                if (!duration) return;
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                seekAt(e.clientX);
            }}
            onPointerMove={(e) => {
                if (dragging.current) seekAt(e.clientX);
            }}
            onPointerUp={() => {
                dragging.current = false;
            }}
            onPointerCancel={() => {
                dragging.current = false;
            }}
            className="relative h-10 flex-1 min-w-0 cursor-pointer touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
            {peaks ? (
                <div className="absolute inset-0 flex items-center gap-px" aria-hidden="true">
                    {peaks.map((peak, i) => (
                        <div
                            key={i}
                            className={`flex-1 ${(i + 0.5) / peaks.length <= progress ? "bg-black" : "bg-gray-300"}`}
                            style={{ height: `${Math.max(peak * 100, 6)}%` }}
                        />
                    ))}
                </div>
            ) : (
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 bg-gray-300" aria-hidden="true">
                    <div className="h-full bg-black" style={{ width: `${progress * 100}%` }} />
                </div>
            )}
        </div>
    );
}

export default function AudioPlayer({ songId }) {

    const audioRef = useRef(null);
    const { src, onError, onLoadedData } = useSignedStreamUrl(songId, audioRef);
    const tracking = usePlayTracking(songId, audioRef);
    const peaks = useWaveform(songId);

    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(savedVolume);
    const [muted, setMuted] = useState(false);

    useEffect(() => {
        if (!audioRef.current) return;
        audioRef.current.volume = volume;
        audioRef.current.muted = muted;
    }, [volume, muted, src]);

    useEffect(() => {
        try {
            localStorage.setItem(VOLUME_KEY, String(volume));
        } catch {
            // Sin almacenamiento el volumen vale solo para esta página.
        }
    }, [volume]);

    // Si otro reproductor arranca, este se pausa.
    useEffect(() => {
        const onOtherPlay = (e) => {
            if (e.detail !== songId) audioRef.current?.pause();
        };
        window.addEventListener(PLAY_EVENT, onOtherPlay);
        return () => window.removeEventListener(PLAY_EVENT, onOtherPlay);
    }, [songId]);

    if (!src) {
        return <p className="text-sm muted mt-2">Cargando audio...</p>;
    }

    const togglePlay = () => {
        const audio = audioRef.current;
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
    };

    const seek = (seconds) => {
        audioRef.current.currentTime = seconds;
        setCurrent(seconds);
    };

    return (
        <div className="mt-2">
            <audio
                ref={audioRef}
                preload="metadata"
                src={src}
                onError={onError}
                onLoadedData={onLoadedData}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onPlay={() => {
                    tracking.onPlay();
                    setPlaying(true);
                    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: songId }));
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
                }}
            />

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? "Pausar" : "Reproducir"}
                    title={playing ? "Pausar" : "Reproducir"}
                    className="shrink-0 btn-primary p-2"
                >
                    {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                </button>

                <WaveformBar peaks={peaks} current={current} duration={duration} onSeek={seek} />
            </div>

            <div className="flex items-center justify-between gap-2 mt-1 text-xs muted">
                <span className="tabular-nums">{formatTime(current)} / {formatTime(duration)}</span>

                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setMuted((m) => !m)}
                        aria-label={muted ? "Activar sonido" : "Silenciar"}
                        aria-pressed={muted}
                        title={muted ? "Activar sonido" : "Silenciar"}
                        className="btn-icon p-1"
                    >
                        {muted || volume === 0 ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />}
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
                        className="w-20 accent-black"
                    />
                </div>
            </div>
        </div>
    );
}
