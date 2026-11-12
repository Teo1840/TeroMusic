import { useEffect, useState } from "react";
import api from "../api/client";
import { errorMessage } from "../lib/format";

export default function Notifications() {

    const [notifications, setNotifications] = useState([]);
    const [error, setError] = useState("");

    useEffect(() => {

        api.get("/notifications/")
            .then(({ data }) => {
                setNotifications(data);
            })
            .catch((err) => {
                setError(
                    errorMessage(
                        err,
                        "No se pudieron cargar las notificaciones."
                    )
                );
            });

    }, []);

    return (
        <div className="page">

            <h1 className="page-title mb-6">
                Notificaciones
            </h1>

            {error && (
                <p
                    className="notice max-w-sm"
                    role="alert"
                >
                    {error}
                </p>
            )}

            {!error && notifications.length === 0 && (
                <p className="muted">
                    No hay notificaciones.
                </p>
            )}

            {!error && notifications.length > 0 && (
                <div className="space-y-4">

                    {notifications.map((notification) => (
                        <div
                            key={notification.id}
                            className="card"
                        >
                            <h2 className="font-semibold">
                                {notification.title}
                            </h2>

                            <p className="muted mt-1">
                                {notification.message}
                            </p>
                        </div>
                    ))}

                </div>
            )}

        </div>
    );
}