import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { saveToken } from "../lib/auth";
import { errorMessage } from "../lib/format";

/**
 * Formulario de login y de registro. Los dos endpoints devuelven el JWT,
 * así que al registrarse se entra directo, sin volver a loguearse.
 */
export default function AuthForm({ title, endpoint, submitLabel, busyLabel, statusMessages, footer }) {

    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        setLoading(true);

        try {
            const { data } = await api.post(endpoint, { email, password });
            if (!data.access_token) throw new Error("El servidor no devolvió un token.");
            saveToken(data.access_token);
            navigate("/catalog");
        } catch (err) {
            setError(statusMessages[err.response?.status] || errorMessage(err, err.message || "No se pudo completar."));
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4">

                <div className="flex items-center gap-2 font-bold">
                    <img src="/tero.svg" alt="" className="h-7 w-7" />
                    TeroMusic
                </div>

                <h1 className="page-title">{title}</h1>

                <input
                    type="email"
                    placeholder="Email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field"
                    required
                />

                <input
                    type="password"
                    placeholder="Contraseña"
                    autoComplete={endpoint === "/auth/register" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="field"
                    required
                />

                {error && <p className="notice" role="alert">{error}</p>}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                    {loading ? busyLabel : submitLabel}
                </button>

                <p className="text-sm">
                    {footer.text}{" "}
                    <Link to={footer.to} className="link">{footer.link}</Link>
                </p>

            </form>
        </div>
    );
}
