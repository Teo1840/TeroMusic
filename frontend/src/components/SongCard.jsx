import AddToPlaylist from "./AddToPlaylist";
import ArtistLink from "./ArtistLink";
import AudioPlayer from "./AudioPlayer";
import { artistLabel, formatTime, initials } from "../lib/format";

/** Tarjeta de una canción publicada: reproductor y agregar a playlist. La usan el catálogo y la página del artista. */
export default function SongCard({ song, queue, showArtist = true }) {
    return (
        <article className="card min-w-0 flex flex-col">
            <div className="flex items-start gap-3">
                <div
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center bg-black font-bold text-white"
                >
                    {initials(showArtist ? artistLabel(song) : song.title)}
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug break-words">{song.title}</h2>
                    {showArtist && <ArtistLink song={song} className="text-sm muted break-words" />}
                </div>
                {Number.isFinite(song.duration) && (
                    <span className="text-xs muted tabular-nums shrink-0 pt-0.5">{formatTime(song.duration)}</span>
                )}
            </div>
            <AudioPlayer song={song} queue={queue} />
            <div className="mt-auto">
                <AddToPlaylist song={song} />
            </div>
        </article>
    );
}
