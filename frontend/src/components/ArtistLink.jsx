import { Link } from "react-router-dom";
import { artistLabel } from "../lib/format";

/**
 * Nombre del artista que lleva a su página. Sin artist_id (datos viejos) queda como texto.
 * `song` es cualquier cosa con artist_id / artist_name: una canción o un elemento de la cola.
 */
export default function ArtistLink({ song, className = "" }) {
    const name = artistLabel(song);
    if (!song?.artist_id) return <span className={className}>{name}</span>;
    return (
        <Link
            to={`/artists/${song.artist_id}`}
            title={`Ver la página de ${name}`}
            className={`hover:underline underline-offset-2 ${className}`}
        >
            {name}
        </Link>
    );
}
