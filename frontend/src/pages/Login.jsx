
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";

export default function Login() {

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

            const response = await api.post(
                "/auth/login",
                {
                    email,
                    password
                }
            );

            const token = response.data.access_token;

            if (!token) {
                throw new Error("El servidor no devolvió un token válido.");
            }

            localStorage.setItem(
                "access_token",
                token
            );

            navigate("/catalog");

        } catch (error) {

            setError(
                error.response?.data?.detail ||
                error.message ||
                "No se pudo iniciar sesión."
            );

        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4">

            <form
                onSubmit={handleSubmit}
                className="w-full max-w-md space-y-4"
            >

                <h1 className="text-2xl font-bold">
                    Iniciar sesión
                </h1>

                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border p-2"
                    required
                />

                <input
                    type="password"
                    placeholder="Contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border p-2"
                    required
                />

                {error && (
                    <p className="text-red-500">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full border p-2 disabled:opacity-50"
                >
                    {loading ? "Ingresando..." : "Iniciar sesión"}
                </button>

                <p>
                    ¿No tenés una cuenta?{" "}
                    <Link to="/register" className="text-blue-600 underline">
                        Registrarse
                    </Link>
                </p>

            </form>

        </div>
    );
}
