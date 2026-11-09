import { useEffect, useState } from "react";
import api from "../api/client";

export default function Catalog() {

    const [songs, setSongs] = useState([]);

    useEffect(() => {

        async function loadSongs() {

            const response =
                await api.get("/catalog/songs");

            setSongs(response.data);
        }

        loadSongs();

    }, []);

    return (
        <div className="p-8">

            <h1 className="text-3xl font-bold mb-6">
                Catalog
            </h1>

            <div className="grid grid-cols-3 gap-4">

                {songs.map(song => (

                    <div
                        key={song.id}
                        className="border rounded p-4"
                    >

                        <h2 className="font-semibold">
                            {song.title}
                        </h2>

                        <p>
                            {song.artist}
                        </p>

                    </div>

                ))}

            </div>

        </div>
    );
}