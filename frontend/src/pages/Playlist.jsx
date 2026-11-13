import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api/client";
import AudioPlayer from "../components/AudioPlayer";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PlusIcon } from "../components/Icons";
import SongSearch from "../components/SongSearch";
import { artistLabel, errorMessage, formatTime } from "../lib/format";

/*
 * Usa estos endpoints de catalog_service (app/playlists.py):
 *
 *   GET    /playlists/{id}                  → { id, name, is_public, is_owner, owner_name,
 *                                               songs: [{ id, title, duration, status }] }
 *                                             (songs en el orden de la playlist)
 *   PATCH  /playlists/{id}                  → body { name?, is_public? } → 200 { id, name, is_public }
 *   POST   /playlists/{id}/songs            → body { song_id } → 201. 409 si ya está.
 *   DELETE /playlists/{id}/songs/{song_id}  → 204
 *   PUT    /playlists/{id}/songs            → body { song_ids: [...] } (orden nuevo completo) → 200
 *
 * El GET responde también a otros usuarios si la playlist está compartida (is_public);
 * todo lo demás es solo del dueño. 403 si es privada de otro, 404 si no existe.
 */
const MAX_NAME = 100;

/** Link para compartir: la misma página, desde el dominio donde se está usando la app. */
function shareUrl(playlistId) {
    return `${window.location.origin}/playlists/${playlistId}`;
}

/** Solo para el dueño: compartir con link o volver a hacerla privada. */
function ShareBox({ playlist, onChange }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const url = shareUrl(playlist.id);

    async function setPublic(isPublic) {
        setSaving(true);
        setError("");
        setCopied(false);
        try {
            const { data } = await api.patch(`/catalog/playlists/${playlist.id}`, { is_public: isPublic });
            onChange(data?.is_public ?? isPublic);
        } catch (err) {
            setError(errorMessage(err, "No se pudo cambiar la visibilidad."));
        } finally {
            setSaving(false);
        }
    }

    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch {
            // Sin permiso de portapapeles: el link queda seleccionable en el campo.
            setError("No se pudo copiar. Seleccioná el link y copialo a mano.");
        }
    }

    return (
        <section className="card mb-6 space-y-3" aria-labelledby="share-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="share-title" className="font-semibold">
                    {playlist.is_public ? "Compartida con link" : "Privada"}
                </h2>
                <button
                    type="button"
                    onClick={() => setPublic(!playlist.is_public)}
                    disabled={saving}
                    className={`${playlist.is_public ? "btn" : "btn-primary"} py-1 text-sm`}
                >
                    {saving ? "Guardando..." : playlist.is_public ? "Dejar de compartir" : "Compartir"}
                </button>
            </div>
            <p className="text-sm muted">
                {playlist.is_public
                    ? "Cualquiera con el link y una cuenta puede verla y escucharla. Solo vos podés editarla."
                    : "Solo vos podés verla. Compartila para mandar el link a quien quieras (por ejemplo, un disco o EP)."}
            </p>
            {playlist.is_public && (
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        type="text"
                        readOnly
                        value={url}
                        aria-label="Link de la playlist"
                        onFocus={(e) => e.target.select()}
                        className="field sm:flex-1 text-sm"
                    />
                    <button type="button" onClick={copy} className="btn-primary text-sm">
                        {copied ? "¡Link copiado!" : "Copiar link"}
                    </button>
                </div>
            )}
            {error && <p className="notice" role="alert">{error}</p>}
        </section>
    );
}

function IconButton({ label, onClick, disabled, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className="btn-icon"
        >
            {children}
        </button>
    );
}

export default function Playlist() {

    const { playlistId } = useParams();

    const [playlist, setPlaylist] = useState(null);
    const [catalog, setCatalog] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [saving, setSaving] = useState(false);

    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");

    const [playingId, setPlayingId] = useState(null);  // canción actual de la cola personal
    const [playSession, setPlaySession] = useState(0);
    const [reordering, setReordering] = useState(false);

    async function loadPlaylist(isCancelled) {
        try {
            const { data } = await api.get(`/catalog/playlists/${playlistId}`);
            if (isCancelled()) return;
            setPlaylist({ ...data, songs: data.songs ?? [] });
            setError("");
        } catch (err) {
            if (isCancelled()) return;
            const status = err?.response?.status;
            if (status === 404 || status === 405) {
                setError("Esta playlist no existe o las playlists todavía no están disponibles.");
            } else if (status === 403) {
                setError("Esta playlist es privada: solo la puede ver quien la creó.");
            } else {
                setError(errorMessage(err, "No se pudo cargar la playlist."));
            }
        } finally {
            if (!isCancelled()) setLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setPlayingId(null);
        setPlaylist(null);
        setNotice("");
        setError("");
        setEditingName(false);
        loadPlaylist(() => cancelled);
        // El catálogo es para el buscador de "Agregar canción": si falla, solo no se puede agregar.
        api.get("/catalog/songs")
            .then(({ data }) => { if (!cancelled) setCatalog(data); })
            .catch(() => { if (!cancelled) setCatalog([]); });
        return () => { cancelled = true; };
    }, [playlistId]);

    // Sin el campo (backend viejo) solo se podían ver las propias.
    const isOwner = playlist?.is_owner !== false;
    const songs = playlist?.songs ?? [];
    const inPlaylist = new Set(songs.map((s) => s.id));
    const addable = catalog.filter((s) => !inPlaylist.has(s.id));
    const playable = songs.filter((song) => (song.status ?? "PUBLICADO") === "PUBLICADO");
    const currentSong = playable.find((song) => song.id === playingId);
    const currentIndex = playable.findIndex((song) => song.id === playingId);

    function playSong(song) {
        setPlayingId(song.id);
        setPlaySession((session) => session + 1);
    }

    function playNext() {
        const next = playable[currentIndex + 1];
        if (next) playSong(next);
        else {
            setPlayingId(null);
            setNotice("Terminó la playlist.");
        }
    }

    async function addSong(song) {
        if (saving || reordering) return;
        setNotice("");
        setSaving(true);
        try {
            await api.post(`/catalog/playlists/${playlistId}/songs`, { song_id: song.id });
            setPlaylist((prev) => ({
                ...prev,
                songs: [...prev.songs, { id: song.id, title: song.title, artist_name: song.artist_name, duration: song.duration, status: "PUBLICADO" }]
            }));
            setNotice(`Se agregó "${song.title}".`);
        } catch (err) {
            if (err?.response?.status === 409) {
                setNotice(`"${song.title}" ya está en la playlist.`);
            } else {
                setNotice(errorMessage(err, "No se pudo agregar la canción."));
            }
        } finally {
            setSaving(false);
        }
    }

    async function removeSong(song) {
        setNotice("");
        setSaving(true);
        try {
            await api.delete(`/catalog/playlists/${playlistId}/songs/${song.id}`);
            setPlaylist((prev) => ({ ...prev, songs: prev.songs.filter((s) => s.id !== song.id) }));
            if (playingId === song.id) setPlayingId(null);
        } catch (err) {
            if (err?.response?.status === 404) {
                setPlaylist((prev) => ({ ...prev, songs: prev.songs.filter((s) => s.id !== song.id) }));
                if (playingId === song.id) setPlayingId(null);
            } else {
                setNotice(errorMessage(err, "No se pudo sacar la canción."));
            }
        } finally {
            setSaving(false);
        }
    }

    // Se mueve en pantalla al instante; si el servidor rechaza el orden nuevo, se vuelve al anterior.
    async function moveSong(index, toIndex) {
        if (saving || reordering) return;
        const previous = songs;
        const reordered = [...songs];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(toIndex, 0, moved);

        setNotice("");
        setReordering(true);
        setPlaylist((prev) => ({ ...prev, songs: reordered }));
        try {
            await api.put(`/catalog/playlists/${playlistId}/songs`, { song_ids: reordered.map((s) => s.id) });
        } catch (err) {
            setPlaylist((prev) => ({ ...prev, songs: previous }));
            setNotice(errorMessage(err, "No se pudo cambiar el orden."));
        } finally {
            setReordering(false);
        }
    }

    async function saveName(e) {
        e.preventDefault();
        const trimmed = nameDraft.trim();
        if (!trimmed || trimmed === playlist.name) {
            setEditingName(false);
            return;
        }
        setSaving(true);
        setNotice("");
        try {
            const { data } = await api.patch(`/catalog/playlists/${playlistId}`, { name: trimmed });
            setPlaylist((prev) => ({ ...prev, name: data?.name ?? trimmed }));
            setEditingName(false);
        } catch (err) {
            setNotice(errorMessage(err, "No se pudo cambiar el nombre."));
        } finally {
            setSaving(false);
        }
    }

    const totalSeconds = songs.reduce((sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 0), 0);

    return (
        <div className="page max-w-3xl">

            <Link to={playlist && !isOwner ? "/catalog" : "/playlists"} className="link text-sm">
                {playlist && !isOwner ? "← Ir al catálogo" : "← Volver a playlists"}
            </Link>

            {loading && <p className="muted mt-4">Cargando la playlist...</p>}

            {error && <p className="notice mt-4" role="alert">{error}</p>}

            {playlist && (
                <div>

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-4 mb-1">
                        {editingName ? (
                            <form onSubmit={saveName} className="flex flex-wrap items-center gap-2 flex-1">
                                <input
                                    type="text"
                                    value={nameDraft}
                                    onChange={(e) => setNameDraft(e.target.value)}
                                    maxLength={MAX_NAME}
                                    aria-label="Nombre de la playlist"
                                    className="field flex-1 min-w-48"
                                    autoFocus
                                />
                                <button type="submit" disabled={saving || !nameDraft.trim()} className="btn-primary py-1 text-sm">
                                    Guardar
                                </button>
                                <button type="button" onClick={() => setEditingName(false)} className="btn py-1 text-sm">
                                    Cancelar
                                </button>
                            </form>
                        ) : (
                            <>
                                <h1 className="page-title break-words min-w-0">{playlist.name}</h1>
                                {isOwner && <button
                                    type="button"
                                    onClick={() => {
                                        setNameDraft(playlist.name);
                                        setEditingName(true);
                                    }}
                                    className="btn py-1 text-sm"
                                >
                                    Cambiar nombre
                                </button>}
                            </>
                        )}
                    </div>

                    <p className="muted text-sm mb-6">
                        {!isOwner && <>Playlist de <strong className="text-black">{playlist.owner_name || "otro usuario"}</strong> · </>}
                        {songs.length === 1 ? "1 canción" : `${songs.length} canciones`}
                        {totalSeconds > 0 && ` · ${formatTime(totalSeconds)}`}
                    </p>

                    {isOwner && (
                        <ShareBox
                            playlist={playlist}
                            onChange={(isPublic) => setPlaylist((prev) => ({ ...prev, is_public: isPublic }))}
                        />
                    )}

                    <div className="mb-6">
                        <button type="button" className="btn-primary" disabled={playable.length === 0}
                            onClick={() => { setNotice(""); playSong(playable[0]); }}>
                            Reproducir playlist
                        </button>
                        {currentSong && (
                            <section className="card mt-3" aria-label="Reproductor de playlist">
                                <p className="font-semibold" aria-live="polite">{currentSong.title}</p>
                                <p className="muted text-sm">Canción {currentIndex + 1} de {playable.length}</p>
                                <AudioPlayer key={`${playingId}-${playSession}`} songId={playingId} autoPlay onEnded={playNext} />
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <button type="button" className="btn py-1 text-sm" disabled={currentIndex <= 0}
                                        onClick={() => playSong(playable[currentIndex - 1])}>Anterior</button>
                                    <button type="button" className="btn py-1 text-sm" disabled={currentIndex >= playable.length - 1}
                                        onClick={playNext}>Siguiente</button>
                                    <button type="button" className="btn py-1 text-sm" onClick={() => setPlayingId(null)}>Detener</button>
                                </div>
                            </section>
                        )}
                    </div>

                    {isOwner && (
                        <div className="card mb-6">
                            <SongSearch
                                songs={addable}
                                icon={<PlusIcon />}
                                label="Agregar canción:"
                                actionIcon={<PlusIcon />}
                                onPick={addSong}
                            />
                        </div>
                    )}

                    {notice && <p className="notice mb-4" role="status">{notice}</p>}

                    {songs.length === 0 && (
                        <p className="muted">
                            {isOwner ? "La playlist está vacía. Buscá una canción arriba para agregarla." : "La playlist está vacía."}
                        </p>
                    )}

                    <ol className="space-y-2">
                        {songs.map((song, index) => {
                            const available = (song.status ?? "PUBLICADO") === "PUBLICADO";
                            const open = playingId === song.id;
                            return (
                                <li key={song.id} className="border border-black px-3 py-2">
                                    <div className="flex items-center gap-1 sm:gap-2">
                                        <span className="text-sm muted w-5 shrink-0 tabular-nums">{index + 1}</span>
                                        <button
                                            type="button"
                                            onClick={() => playSong(song)}
                                            disabled={!available}
                                            aria-current={open ? "true" : undefined}
                                            aria-label={`Reproducir desde ${song.title}`}
                                            className="flex-1 min-w-0 text-left break-words hover:underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                                        >
                                            {song.title}
                                            <span className="block text-xs muted">{artistLabel(song)}</span>
                                            {!available && <span className="block text-xs muted">No disponible</span>}
                                        </button>
                                        {/* Con los botones de editar, en el celular no entra la duración. */}
                                        <span className={`${isOwner ? "hidden sm:inline" : ""} text-xs muted tabular-nums`}>
                                            {song.duration != null && formatTime(song.duration)}
                                        </span>
                                        {isOwner && <>
                                            <IconButton label="Subir" disabled={saving || reordering || index === 0} onClick={() => moveSong(index, index - 1)}>
                                                <ArrowUpIcon />
                                            </IconButton>
                                            <IconButton label="Bajar" disabled={saving || reordering || index === songs.length - 1} onClick={() => moveSong(index, index + 1)}>
                                                <ArrowDownIcon />
                                            </IconButton>
                                            <IconButton label={`Sacar "${song.title}" de la playlist`} disabled={saving || reordering} onClick={() => removeSong(song)}>
                                                <CloseIcon />
                                            </IconButton>
                                        </>}
                                    </div>
                                </li>
                            );
                        })}
                    </ol>

                </div>
            )}

        </div>
    );
}
