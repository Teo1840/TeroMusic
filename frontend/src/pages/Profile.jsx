import { useEffect, useState } from "react";
import api from "../api/client";
import { errorMessage } from "../lib/format";

/*
 * Usa estos endpoints de user_service (app/routers/profile.py):
 *
 *   GET   /auth/me   → { id, email, username, display_name, role, created_at }
 *   PATCH /auth/me   → body { display_name } → el perfil actualizado.
 *
 * El nombre de artista llega al catálogo por el evento user.profile_updated.v1,
 * así que puede tardar unos segundos en verse en las canciones.
 */
const MAX_NAME = 64;

export default function Profile() {

    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.get("/auth/me")
            .then(({ data }) => {
                setProfile(data);
                setName(data.display_name);
            })
            .catch((err) => setError(errorMessage(err, "No se pudo cargar tu perfil.")))
            .finally(() => setLoading(false));
    }, []);

    const trimmed = name.trim();
    const unchanged = profile && trimmed === profile.display_name;

    async function save(e) {
        e.preventDefault();
        if (!trimmed || unchanged) return;
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const { data } = await api.patch("/auth/me", { display_name: trimmed });
            setProfile(data);
            setName(data.display_name);
            setNotice("Listo. Tus canciones van a mostrar el nombre nuevo en unos segundos.");
        } catch (err) {
            setError(errorMessage(err, "No se pudo guardar el nombre."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="page max-w-xl">

            <h1 className="page-title mb-6">Perfil</h1>

            {loading && <p className="muted">Cargando perfil...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {profile && (
                <div className="space-y-6">

                    <form onSubmit={save} className="card space-y-3">
                        <label htmlFor="display-name" className="block font-semibold">
                            Nombre de artista
                        </label>
                        <p className="text-sm muted">
                            Es el nombre que ven los demás en el catálogo y en las playlists.
                        </p>
                        <input
                            id="display-name"
                            type="text"
                            value={name}
                            maxLength={MAX_NAME}
                            onChange={(e) => {
                                setName(e.target.value);
                                setNotice("");
                            }}
                            className="field"
                            required
                        />
                        {notice && <p className="text-sm" role="status">{notice}</p>}
                        <button type="submit" disabled={saving || !trimmed || unchanged} className="btn-primary">
                            {saving ? "Guardando..." : "Guardar"}
                        </button>
                    </form>

                    <dl className="text-sm space-y-1">
                        <div className="flex gap-2">
                            <dt className="muted">Email:</dt>
                            <dd className="break-all">{profile.email}</dd>
                        </div>
                        <div className="flex gap-2">
                            <dt className="muted">Usuario:</dt>
                            <dd>{profile.username}</dd>
                        </div>
                    </dl>

                </div>
            )}

        </div>
    );
}
