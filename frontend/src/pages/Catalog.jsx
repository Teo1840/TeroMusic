
import { useEffect, useState } from "react";
import api from "../api/client";
import AudioPlayer from "../components/AudioPlayer";
import UploadSong from "../components/UploadSong";

export default function Catalog() {

    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    async function loadSongs() {
        try {
            const response = await api.get("/catalog/songs");

            setSongs(response.data);
            setError("");

        } catch (err) {
            setError(
                err.response?.data?.detail ||
                "No se pudo cargar el catálogo."
            );

        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSongs();
    }, []);

    return (
        <div className="p-8">

            <h1 className="text-3xl font-bold mb-6">
                Catálogo
            </h1>

            <UploadSong onPublished={loadSongs} />

            {loading && (
                <p>Cargando canciones...</p>
            )}

            {error && (
                <p className="text-red-500">
                    {error}
                </p>
            )}

            {!loading && !error && songs.length === 0 && (
                <p>No hay canciones disponibles.</p>
            )}

            {!loading && !error && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                    {songs.map(song => (

                        <div
                            key={song.id}
                            className="border rounded p-4"
                        >

                            <h2 className="font-semibold">
                                {song.title}
                            </h2>

                            <AudioPlayer songId={song.id} />

                            <p>
                                {song.artist_id}
                            </p>

                        </div>

                    ))}

                </div>
            )}

        </div>
    );
}
