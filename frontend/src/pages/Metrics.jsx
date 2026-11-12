import { useEffect, useState } from "react";
import api from "../api/client";
import { errorMessage } from "../lib/format";

export default function Metrics() {

    const [plays, setPlays] = useState(null);
    const [error, setError] = useState("");

    useEffect(() => {
        api.get("/metrics/plays")
            .then(({ data }) => setPlays(data.plays))
            .catch((err) => setError(errorMessage(err, "No se pudieron cargar las métricas.")));
    }, []);

    return (
        <div className="page">

            <h1 className="page-title mb-6">Métricas</h1>

            {error && <p className="notice max-w-sm" role="alert">{error}</p>}

            {!error && (
                <div className="card max-w-sm">
                    <p className="text-5xl font-bold tabular-nums">{plays ?? "–"}</p>
                    <p className="muted mt-1">Reproducciones en total</p>
                </div>
            )}

        </div>
    );
}
