import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import DailyPlaysChart from "../components/DailyPlaysChart";
import { clearToken, saveToken } from "../lib/auth";
import { errorMessage, formatDate, formatMonthYear, initials } from "../lib/format";

/*
 * Usa estos endpoints:
 *
 *   GET   /auth/me              → { id, email, username, display_name, role, created_at }
 *   PATCH /auth/me              → body { display_name } → el perfil actualizado.
 *   GET   /catalog/songs/mine   → canciones propias en cualquier estado.
 *   GET   /catalog/playlists    → [{ id, name, song_count }]
 *   POST  /metrics/songs/batch  → body { song_ids } → { songs: [{ song_id, total_plays }] }
 *                                 (todas las publicadas en un pedido, hasta 500 por pedido)
 *   POST  /metrics/songs/daily  → body { song_ids, days, tz } → { days: [{ date, plays }], total }
 *   POST  /auth/me/password     → body { current_password, new_password } → { access_token }
 *                                 (las otras sesiones se cierran; esta sigue con el token nuevo)
 *   DELETE /auth/me             → body { password } → 204. Se borran también sus canciones,
 *                                 playlists y avisos (user.deleted.v1).
 *
 * El nombre de artista llega al catálogo por el evento user.profile_updated.v1,
 * así que puede tardar unos segundos en verse en las canciones.
 *
 * Cada bloque de actividad carga por separado: si uno falla se muestra "–"
 * y el resto de la página sigue andando.
 */
const MAX_NAME = 64;
const FAILED = "error";
// Igual a BATCH_MAX de metrics_service (app/models.py).
const METRICS_BATCH = 500;

const ROLE_LABEL = { user: "Usuario", admin: "Administrador" };
const DAILY_DAYS = 30;
const PASSWORD_MIN = 8;

export default function Profile() {

    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // null = cargando, FAILED = no se pudo, si no el dato.
    const [songs, setSongs] = useState(null);
    const [playlists, setPlaylists] = useState(null);
    const [plays, setPlays] = useState(null);  // { total, top: { title, plays } | null }
    const [daily, setDaily] = useState(null);  // { days, total } de tus canciones

    useEffect(() => {
        let alive = true;

        api.get("/auth/me")
            .then(({ data }) => alive && setProfile(data))
            .catch((err) => alive && setError(errorMessage(err, "No se pudo cargar tu perfil.")))
            .finally(() => alive && setLoading(false));

        api.get("/catalog/playlists")
            .then(({ data }) => alive && setPlaylists(data))
            .catch(() => alive && setPlaylists(FAILED));

        api.get("/catalog/songs/mine")
            .then(({ data }) => {
                if (!alive) return;
                setSongs(data);
                const published = data.filter((s) => s.status === "PUBLICADO");
                loadDaily(published)
                    .then((result) => alive && setDaily(result))
                    .catch(() => alive && setDaily(FAILED));
                return loadPlays(published);
            })
            .then((result) => alive && result !== undefined && setPlays(result))
            .catch(() => {
                if (!alive) return;
                setSongs((prev) => prev ?? FAILED);
                setPlays(FAILED);
            });

        return () => { alive = false; };
    }, []);

    return (
        <div className="page max-w-3xl">

            {loading && <p className="muted">Cargando perfil...</p>}

            {error && <p className="notice mb-4" role="alert">{error}</p>}

            {profile && (
                <div className="space-y-6">
                    <ProfileHeader profile={profile} />
                    <ActivityStats songs={songs} playlists={playlists} plays={plays} />
                    <MyDailyPlays daily={daily} />
                    <NameForm profile={profile} onSaved={setProfile} />
                    <PasswordForm />
                    <AccountInfo profile={profile} />
                    <DeleteAccount />
                </div>
            )}

        </div>
    );
}

/** Reproducciones por día de las canciones publicadas (las primeras 500). null si no hay. */
async function loadDaily(published) {
    if (published.length === 0) return null;
    let tz = "UTC";
    try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch { /* se queda en UTC */ }
    const { data } = await api.post("/metrics/songs/daily", {
        song_ids: published.slice(0, METRICS_BATCH).map((s) => s.id),
        days: DAILY_DAYS,
        tz
    });
    return data;
}

function MyDailyPlays({ daily }) {
    if (daily === null) return null;
    return (
        <section aria-labelledby="daily-title" className="card space-y-3">
            <div>
                <h2 id="daily-title" className="section-title">Tus reproducciones por día</h2>
                <p className="muted text-sm mt-1">
                    {daily === FAILED
                        ? "No se pudieron cargar."
                        : `${daily.total.toLocaleString("es")} en los últimos ${DAILY_DAYS} días, sumando todas tus canciones.`}
                </p>
            </div>
            {daily !== FAILED && <DailyPlaysChart days={daily.days} title="Tus reproducciones por día" />}
        </section>
    );
}

/** Suma las reproducciones de las canciones publicadas y busca la más escuchada. */
async function loadPlays(published) {
    if (published.length === 0) return { total: 0, top: null };

    // Un pedido cada METRICS_BATCH canciones (normalmente uno solo). Si alguno falla
    // no se muestra un total incompleto: se marca como no disponible.
    const chunks = [];
    for (let i = 0; i < published.length; i += METRICS_BATCH) {
        chunks.push(published.slice(i, i + METRICS_BATCH).map((song) => song.id));
    }
    let responses;
    try {
        responses = await Promise.all(
            chunks.map((song_ids) => api.post("/metrics/songs/batch", { song_ids }))
        );
    } catch {
        return FAILED;
    }
    const counts = new Map(
        responses.flatMap(({ data }) => data.songs.map((s) => [s.song_id, s.total_plays]))
    );

    let total = 0;
    let top = null;
    for (const song of published) {
        const count = counts.get(song.id) ?? 0;
        total += count;
        if (count > 0 && (!top || count > top.plays)) {
            top = { title: song.title, plays: count };
        }
    }
    return { total, top };
}

function ProfileHeader({ profile }) {
    const since = formatMonthYear(profile.created_at);
    return (
        <header className="flex items-center gap-4 sm:gap-6 border-b border-black pb-6">
            <div
                aria-hidden="true"
                className="flex h-16 w-16 sm:h-24 sm:w-24 shrink-0 items-center justify-center bg-black text-2xl sm:text-4xl font-bold text-white"
            >
                {initials(profile.display_name)}
            </div>
            <div className="min-w-0">
                <p className="text-xs uppercase tracking-widest muted">Perfil</p>
                <h1 className="page-title break-words">{profile.display_name}</h1>
                <p className="muted break-all">@{profile.username}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    {since && <span className="muted">Miembro desde {since}</span>}
                    {profile.role && profile.role !== "user" && (
                        <span className="border border-black px-2 text-xs uppercase">
                            {ROLE_LABEL[profile.role] ?? profile.role}
                        </span>
                    )}
                </div>
            </div>
        </header>
    );
}

function ActivityStats({ songs, playlists, plays }) {
    const songList = Array.isArray(songs) ? songs : null;
    const count = (status) => songList?.filter((s) => s.status === status).length ?? 0;
    const processing = count("BORRADOR");
    const failed = count("FALLIDO");
    const extra = [
        processing > 0 && `${processing} procesando`,
        failed > 0 && `${failed} ${failed === 1 ? "fallida" : "fallidas"}`
    ].filter(Boolean).join(" · ");

    const value = (data, pick) => {
        if (data === null) return "…";
        if (data === FAILED) return "–";
        return pick(data);
    };

    return (
        <section aria-labelledby="activity-title" className="space-y-3">
            <h2 id="activity-title" className="section-title">Actividad</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat
                    label="Canciones publicadas"
                    value={value(songs, () => count("PUBLICADO"))}
                    detail={extra}
                    to="/my-songs"
                />
                <Stat
                    label="Playlists"
                    value={value(playlists, (p) => p.length)}
                    to="/playlists"
                />
                <Stat
                    label="Reproducciones"
                    value={value(plays, (p) => p.total.toLocaleString("es"))}
                />
                <Stat
                    label="Más escuchada"
                    value={value(plays, (p) => p.top?.title ?? "–")}
                    detail={plays && plays !== FAILED && plays.top
                        ? `${plays.top.plays.toLocaleString("es")} ${plays.top.plays === 1 ? "reproducción" : "reproducciones"}`
                        : ""}
                    small
                />
            </div>

            {songList && songList.length === 0 && (
                <p className="muted text-sm">
                    Todavía no subiste canciones. <Link to="/upload" className="link">Subí la primera</Link>.
                </p>
            )}
        </section>
    );
}

function Stat({ label, value, detail, to, small }) {
    const body = (
        <>
            <p className={`${small ? "text-lg break-words" : "text-4xl tabular-nums"} font-bold`}>{value}</p>
            <p className="muted text-sm mt-1">{label}</p>
            {detail && <p className="text-xs muted">{detail}</p>}
        </>
    );
    return to ? (
        <Link to={to} className="card block min-w-0 hover:bg-black hover:text-white [&:hover_.muted]:text-gray-300">
            {body}
        </Link>
    ) : (
        <div className="card min-w-0">{body}</div>
    );
}

function NameForm({ profile, onSaved }) {
    const [name, setName] = useState(profile.display_name);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const trimmed = name.trim();
    const unchanged = trimmed === profile.display_name;

    async function save(e) {
        e.preventDefault();
        if (!trimmed || unchanged) return;
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const { data } = await api.patch("/auth/me", { display_name: trimmed });
            onSaved(data);
            setName(data.display_name);
            setNotice("Listo. Tus canciones van a mostrar el nombre nuevo en unos segundos.");
        } catch (err) {
            setError(errorMessage(err, "No se pudo guardar el nombre."));
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={save} className="card space-y-3">
            <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="display-name" className="section-title">
                    Nombre de artista
                </label>
                <span className="text-xs muted tabular-nums" aria-live="polite">
                    {name.length}/{MAX_NAME}
                </span>
            </div>
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
                    setError("");
                }}
                className="field"
                required
            />
            {error && <p className="notice" role="alert">{error}</p>}
            {notice && <p className="text-sm" role="status">{notice}</p>}
            <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={saving || !trimmed || unchanged} className="btn-primary">
                    {saving ? "Guardando..." : "Guardar"}
                </button>
                {!unchanged && (
                    <button
                        type="button"
                        onClick={() => setName(profile.display_name)}
                        disabled={saving}
                        className="btn"
                    >
                        Cancelar
                    </button>
                )}
            </div>
        </form>
    );
}

function AccountInfo({ profile }) {
    const rows = [
        ["Email", profile.email],
        ["Usuario", `@${profile.username}`],
        ["Rol", ROLE_LABEL[profile.role] ?? profile.role],
        ["Alta", formatDate(profile.created_at)]
    ];
    return (
        <section aria-labelledby="account-title" className="card space-y-3">
            <h2 id="account-title" className="section-title">Cuenta</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {rows.map(([label, val]) => (
                    <div key={label} className="contents">
                        <dt className="muted">{label}</dt>
                        <dd className="break-all">{val || "–"}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}


function PasswordForm() {
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");
    const [repeat, setRepeat] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const mismatch = repeat !== "" && next !== repeat;
    const tooShort = next !== "" && next.length < PASSWORD_MIN;
    const ready = current && next && repeat && !mismatch && !tooShort;

    async function submit(e) {
        e.preventDefault();
        if (!ready) return;
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const { data } = await api.post("/auth/me/password", { current_password: current, new_password: next });
            saveToken(data.access_token);
            setCurrent("");
            setNext("");
            setRepeat("");
            setNotice("Listo. Cambiaste tu contraseña y se cerraron tus otras sesiones.");
        } catch (err) {
            setError(errorMessage(err, "No se pudo cambiar la contraseña."));
        } finally {
            setSaving(false);
        }
    }

    const field = (id, label, value, set, autoComplete) => (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
            <input
                id={id}
                type="password"
                value={value}
                autoComplete={autoComplete}
                onChange={(e) => {
                    set(e.target.value);
                    setError("");
                    setNotice("");
                }}
                className="field"
                required
            />
        </div>
    );

    return (
        <form onSubmit={submit} aria-labelledby="password-title" className="card space-y-3">
            <h2 id="password-title" className="section-title">Contraseña</h2>
            <p className="text-sm muted">
                Al cambiarla se cierra la sesión en tus otros dispositivos. En este seguís adentro.
            </p>
            {field("current-password", "Contraseña actual", current, setCurrent, "current-password")}
            {field("new-password", "Contraseña nueva", next, setNext, "new-password")}
            {tooShort && <p className="text-sm">Tiene que tener al menos {PASSWORD_MIN} caracteres.</p>}
            {field("repeat-password", "Repetí la contraseña nueva", repeat, setRepeat, "new-password")}
            {mismatch && <p className="text-sm">Las dos contraseñas nuevas no coinciden.</p>}
            {error && <p className="notice" role="alert">{error}</p>}
            {notice && <p className="text-sm" role="status">{notice}</p>}
            <button type="submit" disabled={saving || !ready} className="btn-primary">
                {saving ? "Guardando..." : "Cambiar contraseña"}
            </button>
        </form>
    );
}

function DeleteAccount() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");

    async function submit(e) {
        e.preventDefault();
        if (!password) return;
        setDeleting(true);
        setError("");
        try {
            await api.delete("/auth/me", { data: { password } });
            clearToken();
            navigate("/login", { replace: true });
        } catch (err) {
            setError(errorMessage(err, "No se pudo borrar la cuenta."));
            setDeleting(false);
        }
    }

    return (
        <section aria-labelledby="delete-title" className="card space-y-3 border-2">
            <h2 id="delete-title" className="section-title">Borrar cuenta</h2>
            <p className="text-sm">
                Se borran para siempre tu cuenta, tus canciones (salen del catálogo, de las playlists de
                otros y de las salas), tus playlists y tus avisos. No se puede deshacer.
            </p>
            {!open ? (
                <button type="button" className="btn" onClick={() => setOpen(true)}>
                    Quiero borrar mi cuenta
                </button>
            ) : (
                <form onSubmit={submit} className="space-y-3">
                    <div className="space-y-1">
                        <label htmlFor="delete-password" className="block text-sm font-semibold">
                            Escribí tu contraseña para confirmar
                        </label>
                        <input
                            id="delete-password"
                            type="password"
                            value={password}
                            autoComplete="current-password"
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError("");
                            }}
                            className="field"
                            required
                        />
                    </div>
                    {error && <p className="notice" role="alert">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={deleting || !password} className="btn-primary">
                            {deleting ? "Borrando..." : "Borrar mi cuenta para siempre"}
                        </button>
                        <button
                            type="button"
                            className="btn"
                            disabled={deleting}
                            onClick={() => {
                                setOpen(false);
                                setPassword("");
                                setError("");
                            }}
                        >
                            Cancelar
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}
