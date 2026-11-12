import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { PlaybackIcon } from "../components/Icons";
import { errorMessage } from "../lib/format";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export default function Rooms() {

    const navigate = useNavigate();

    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [name, setName] = useState("");
    const [visibility, setVisibility] = useState("public");
    const [maxListeners, setMaxListeners] = useState(20);
    const [creating, setCreating] = useState(false);

    const [link, setLink] = useState("");

    async function loadRooms() {
        try {
            const { data } = await api.get("/rooms");
            setRooms(data);
            setError("");
        } catch (err) {
            setError(errorMessage(err, "No se pudieron cargar las salas."));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadRooms();
        const timer = setInterval(loadRooms, 5000);
        return () => clearInterval(timer);
    }, []);

    async function createRoom(event) {
        event.preventDefault();
        setCreating(true);
        try {
            const { data } = await api.post("/rooms", {
                name: name.trim(),
                visibility,
                max_listeners: Number(maxListeners)
            });
            navigate(`/rooms/${data.id}`);
        } catch (err) {
            setError(errorMessage(err, "No se pudo crear la sala."));
            setCreating(false);
        }
    }

    function joinByLink(event) {
        event.preventDefault();
        const id = link.match(UUID)?.[0];
        if (id) navigate(`/rooms/${id}`);
        else setError("Pegá el link de la sala (o su código).");
    }

    return (
        <div className="page max-w-4xl">

            <h1 className="page-title mb-2">Salas en vivo</h1>
            <p className="muted mb-6">
                Escuchen la misma canción, al mismo tiempo, desde distintos dispositivos.
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-8">

                <form onSubmit={createRoom} className="card space-y-3">
                    <h2 className="section-title">Crear sala</h2>

                    <input
                        type="text"
                        placeholder="Nombre de la sala"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        required
                        className="field"
                    />

                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                        <label className="flex items-center gap-1">
                            <input
                                type="radio"
                                className="accent-black"
                                checked={visibility === "public"}
                                onChange={() => setVisibility("public")}
                            />
                            Pública
                        </label>
                        <label className="flex items-center gap-1">
                            <input
                                type="radio"
                                className="accent-black"
                                checked={visibility === "private"}
                                onChange={() => setVisibility("private")}
                            />
                            Privada (solo con link)
                        </label>
                    </div>

                    <label className="block">
                        Máximo de oyentes
                        <input
                            type="number"
                            min={2}
                            max={500}
                            value={maxListeners}
                            onChange={(e) => setMaxListeners(e.target.value)}
                            className="field w-24 p-1 ml-2"
                        />
                    </label>

                    <button
                        type="submit"
                        disabled={creating}
                        className="btn-primary"
                    >
                        {creating ? "Creando..." : "Crear y entrar"}
                    </button>
                </form>

                <form onSubmit={joinByLink} className="card space-y-3">
                    <h2 className="section-title">Entrar con link</h2>
                    <p className="text-sm muted">
                        Para salas privadas: pegá el link que te pasó el anfitrión.
                    </p>
                    <input
                        type="text"
                        placeholder="http://localhost:5173/rooms/..."
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        className="field"
                    />
                    <button type="submit" className="btn">
                        Entrar
                    </button>
                </form>

            </div>

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            <h2 className="section-title mb-3">Salas públicas</h2>

            {loading && <p className="muted">Cargando salas...</p>}

            {!loading && rooms.length === 0 && (
                <p className="muted">No hay salas abiertas. ¡Creá la primera!</p>
            )}

            <div className="grid md:grid-cols-2 gap-4">
                {rooms.map((room) => (
                    <button
                        key={room.id}
                        onClick={() => navigate(`/rooms/${room.id}`)}
                        className="card text-left hover:bg-gray-100"
                    >
                        <h3 className="font-semibold break-words">{room.name}</h3>
                        <p className="text-sm muted">Anfitrión: {room.host_name}</p>
                        <p className="text-sm">
                            {room.listeners} / {room.max_listeners} escuchando
                        </p>
                        <p className="text-sm">
                            {room.now_playing
                                ? <><PlaybackIcon playing={room.playing} size={14} /> {room.now_playing}</>
                                : "Sin música todavía"}
                        </p>
                    </button>
                ))}
            </div>

        </div>
    );
}
