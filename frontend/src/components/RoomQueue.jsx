import { formatTime } from "../lib/format";
import ArtistLink from "./ArtistLink";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, PlusIcon } from "./Icons";
import SongSearch from "./SongSearch";

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

/**
 * Cola de la sala ("a continuación") y sugerencias.
 * Anfitrión/coanfitriones: agregan, reordenan, sacan y aceptan/rechazan sugerencias.
 * Oyentes: ven la cola y sugieren canciones.
 */
export default function RoomQueue({ queue, suggestions, canControl, me, send }) {
    function addSong(song) {
        send({ type: canControl ? "queue_add" : "suggest", song_id: song.id });
    }

    return (
        <div className="card mb-6 space-y-4">

            <SongSearch
                icon={<PlusIcon />}
                label={canControl ? "Agregar a la cola:" : "Sugerir canción:"}
                actionIcon={<PlusIcon />}
                onPick={addSong}
            />

            <div>
                <h3 className="font-semibold mb-2">A continuación ({queue.length})</h3>

                {queue.length === 0 && (
                    <p className="text-sm muted">
                        La cola está vacía. Cuando termine la canción, la sala queda en silencio.
                    </p>
                )}

                <ol className="space-y-1">
                    {queue.map((item, index) => (
                        <li key={item.item_id} className="flex items-center gap-2 border border-black px-3 py-1.5">
                            <span className="text-sm muted w-5 tabular-nums">{index + 1}</span>
                            <span className="flex-1 min-w-0 break-words">
                                {item.title}
                                <span className="block text-xs muted truncate">
                                    <ArtistLink song={item} /> · agregada por {item.added_by.name}
                                </span>
                            </span>
                            <span className="text-xs muted tabular-nums">{item.duration_sec > 0 && formatTime(item.duration_sec)}</span>
                            {canControl && (
                                <>
                                    <IconButton
                                        label="Subir"
                                        disabled={index === 0}
                                        onClick={() => send({ type: "queue_move", item_id: item.item_id, to_index: index - 1 })}
                                    >
                                        <ArrowUpIcon />
                                    </IconButton>
                                    <IconButton
                                        label="Bajar"
                                        disabled={index === queue.length - 1}
                                        onClick={() => send({ type: "queue_move", item_id: item.item_id, to_index: index + 1 })}
                                    >
                                        <ArrowDownIcon />
                                    </IconButton>
                                    <IconButton
                                        label="Sacar de la cola"
                                        onClick={() => send({ type: "queue_remove", item_id: item.item_id })}
                                    >
                                        <CloseIcon />
                                    </IconButton>
                                </>
                            )}
                        </li>
                    ))}
                </ol>
            </div>

            {(suggestions.length > 0 || !canControl) && (
                <div>
                    <h3 className="font-semibold mb-2">Sugerencias ({suggestions.length})</h3>

                    {suggestions.length === 0 && (
                        <p className="text-sm muted">
                            Sugerí una canción y el anfitrión decide si la agrega a la cola.
                        </p>
                    )}

                    <ul className="space-y-1">
                        {suggestions.map((item) => (
                            <li key={item.item_id} className="flex items-center gap-2 border border-dashed border-black px-3 py-1.5">
                                <span className="flex-1 min-w-0 break-words">
                                    {item.title}
                                    <span className="block text-xs muted truncate">
                                        <ArtistLink song={item} /> · sugerida por {item.added_by.user_id === me?.user_id ? "vos" : item.added_by.name}
                                    </span>
                                </span>
                                {canControl && (
                                    <>
                                        <IconButton
                                            label="Agregar a la cola"
                                            onClick={() => send({ type: "suggestion_accept", item_id: item.item_id })}
                                        >
                                            <CheckIcon />
                                        </IconButton>
                                        <IconButton
                                            label="Rechazar"
                                            onClick={() => send({ type: "suggestion_reject", item_id: item.item_id })}
                                        >
                                            <CloseIcon />
                                        </IconButton>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

        </div>
    );
}
