import { useEffect, useState } from "react";
import api from "../api/client";
import { errorMessage } from "../lib/format";

export default function Metrics() {

    const [top, setTop] = useState([]);
    const [error, setError] = useState("");

    useEffect(() => {

        async function loadTop() {
            try {
                const { data } = await api.get("/metrics/top");

                setTop(data);
                setError("");

            } catch (err) {
                setError(
                    errorMessage(
                        err,
                        "No se pudieron cargar las métricas."
                    )
                );
            }
        }

        loadTop();

        const interval = setInterval(
            loadTop,
            5000
        );

        return () => clearInterval(interval);

    }, []);

    return (
        <div className="page">

            <h1 className="page-title mb-6">
                Métricas
            </h1>

            {error && (
                <p
                    className="notice max-w-sm"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {!error && top.length === 0 && (
                <p className="muted">
                    No hay métricas disponibles.
                </p>
            )}

            {!error && top.length > 0 && (
                <div className="card max-w-2xl">

                    <h2 className="text-xl font-semibold mb-4">
                        Top de reproducciones
                    </h2>

                    <div className="space-y-3">

                        {top.map((item, index) => (
                            <div
                                key={item.id ?? index}
                                className="flex items-center justify-between border-b pb-2"
                            >
                                <div>
                                    <span className="font-semibold">
                                        #{index + 1}
                                    </span>

                                    <span className="ml-3">
                                        {item.title ?? item.name ?? item.id}
                                    </span>
                                </div>

                                <span className="font-semibold tabular-nums">
                                    {item.plays}
                                </span>
                            </div>
                        ))}

                    </div>

                </div>
            )}

        </div>
    );
}