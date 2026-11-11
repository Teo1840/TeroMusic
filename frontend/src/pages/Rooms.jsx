import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

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
            setError(err.response?.data?.detail || "No se pudieron cargar las salas.");
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
            setError(err.response?.data?.detail || "No se pudo crear la sala.");
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
        <div className="p-8 max-w-4xl">

            <h1 className="text-3xl font-bold mb-2">Salas en vivo</h1>
            <p className="text-gray-600 mb-6">
                Escuchen la misma canción, al mismo tiempo, desde distintos dispositivos.
            </p>

            <div className="grid md:grid-cols-2 gap-4 mb-8">

                <form onSubmit={createRoom} className="border rounded p-4 space-y-3">
                    <h2 className="text-xl font-semibold">Crear sala</h2>

                    <input
                        type="text"
                        placeholder="Nombre de la sala"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        required
                        className="w-full border p-2"
                    />

                    <div className="flex gap-4">
                        <label className="flex items-center gap-1">
                            <input
                                type="radio"
                                checked={visibility === "public"}
                                onChange={() => setVisibility("public")}
                            />
                            Pública
                        </label>
                        <label className="flex items-center gap-1">
                            <input
                                type="radio"
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
                            className="w-24 border p-1 ml-2"
                        />
                    </label>

                    <button
                        type="submit"
                        disabled={creating}
                        className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
                    >
                        {creating ? "Creando..." : "Crear y entrar"}
                    </button>
                </form>

                <form onSubmit={joinByLink} className="border rounded p-4 space-y-3">
                    <h2 className="text-xl font-semibold">Entrar con link</h2>
                    <p className="text-sm text-gray-600">
                        Para salas privadas: pegá el link que te pasó el anfitrión.
                    </p>
                    <input
                        type="text"
                        placeholder="http://localhost:5173/rooms/..."
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        className="w-full border p-2"
                    />
                    <button type="submit" className="border px-4 py-2 rounded">
                        Entrar
                    </button>
                </form>

            </div>

            {error && <p className="text-red-500 mb-4">{error}</p>}

            <h2 className="text-xl font-semibold mb-3">Salas públicas</h2>

            {loading && <p>Cargando salas...</p>}

            {!loading && rooms.length === 0 && (
                <p className="text-gray-600">No hay salas abiertas. ¡Creá la primera!</p>
            )}

            <div className="grid md:grid-cols-2 gap-4">
                {rooms.map((room) => (
                    <button
                        key={room.id}
                        onClick={() => navigate(`/rooms/${room.id}`)}
                        className="border rounded p-4 text-left hover:bg-gray-50"
                    >
                        <h3 className="font-semibold">{room.name}</h3>
                        <p className="text-sm text-gray-600">Anfitrión: {room.host_name}</p>
                        <p className="text-sm">
                            {room.listeners} / {room.max_listeners} escuchando
                        </p>
                        <p className="text-sm">
                            {room.now_playing
                                ? `${room.playing ? "▶" : "⏸"} ${room.now_playing}`
                                : "Sin música todavía"}
                        </p>
                    </button>
                ))}
            </div>

        </div>
    );
}
