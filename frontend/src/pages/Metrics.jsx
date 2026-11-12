import { useEffect, useState } from "react";
import api from "../api/client";

export default function Metrics() {

    const [plays, setPlays] = useState(0);

    useEffect(() => {

        async function loadMetrics() {

            const response =
                await api.get("/metrics/plays");

            setPlays(response.data.plays);
        }

        loadMetrics();

    }, []);

    return (
        <div className="p-4 sm:p-8">

            <h1 className="text-2xl sm:text-3xl font-bold">
                Metrics
            </h1>

            <div className="text-5xl mt-8">
                {plays}
            </div>

            <p>
                Total plays
            </p>

        </div>
    );
}