import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";

export default function Register() {
    const navigate = useNavigate();

    const [form, setForm] = useState({
        email: "",
        password: ""
    });

    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    function handleChange(e) {
        setForm({
            ...form,
            [e.target.name]: e.target.value
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            await api.post("/auth/register", form);
            navigate("/login");

        } catch (err) {
            setError(
                err.response?.data?.detail ||
                "No se pudo completar el registro."
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
                    Crear cuenta
                </h1>

                <input
                    name="email"
                    type="email"
                    placeholder="Correo electrónico"
                    value={form.email}
                    onChange={handleChange}
                    className="w-full border p-2"
                    required
                />

                <input
                    name="password"
                    type="password"
                    placeholder="Contraseña"
                    value={form.password}
                    onChange={handleChange}
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
                    {loading ? "Registrando..." : "Registrarse"}
                </button>

                <p>
                    ¿Ya tenés una cuenta?{" "}
                    <Link
                        to="/login"
                        className="text-blue-600 underline"
                    >
                        Iniciar sesión
                    </Link>
                </p>

            </form>
        </div>
    );
}
