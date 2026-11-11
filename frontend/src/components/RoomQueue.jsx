import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CloseIcon, PlusIcon } from "./Icons";

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const s = Math.round(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function IconButton({ label, onClick, disabled, danger, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className={`p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent ${danger ? "text-red-600" : ""}`}
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
export default function RoomQueue({ queue, suggestions, songs, canControl, me, send }) {

    function addSong(songId) {
        if (!songId) return;
        send({ type: canControl ? "queue_add" : "suggest", song_id: songId });
    }

    return (
        <div className="border rounded p-4 mb-6 space-y-4">

            <label className="flex flex-wrap items-center gap-2 text-sm">
                <PlusIcon />
                {canControl ? "Agregar a la cola:" : "Sugerir canción:"}
                <select
                    value=""
                    onChange={(e) => addSong(e.target.value)}
                    className="border p-1"
                >
                    <option value="">Elegir...</option>
                    {songs.map((song) => (
                        <option key={song.id} value={song.id}>{song.title}</option>
                    ))}
                </select>
            </label>

            <div>
                <h3 className="font-semibold mb-2">A continuación ({queue.length})</h3>

                {queue.length === 0 && (
                    <p className="text-sm text-gray-500">
                        La cola está vacía. Cuando termine la canción, la sala queda en silencio.
                    </p>
                )}

                <ol className="space-y-1">
                    {queue.map((item, index) => (
                        <li key={item.item_id} className="flex items-center gap-2 border rounded px-3 py-1.5">
                            <span className="text-sm text-gray-500 w-5">{index + 1}</span>
                            <span className="flex-1">
                                {item.title}
                                <span className="text-xs text-gray-500"> · agregada por {item.added_by.name}</span>
                            </span>
                            <span className="text-xs text-gray-500">{formatDuration(item.duration_sec)}</span>
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
                                        danger
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
                        <p className="text-sm text-gray-500">
                            Sugerí una canción y el anfitrión decide si la agrega a la cola.
                        </p>
                    )}

                    <ul className="space-y-1">
                        {suggestions.map((item) => (
                            <li key={item.item_id} className="flex items-center gap-2 border border-dashed rounded px-3 py-1.5">
                                <span className="flex-1">
                                    {item.title}
                                    <span className="text-xs text-gray-500">
                                        {" "}· sugerida por {item.added_by.user_id === me?.user_id ? "vos" : item.added_by.name}
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
                                            danger
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
