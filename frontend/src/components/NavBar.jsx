import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearToken, currentRole } from "../lib/auth";
import { UNREAD_EVENT, badgeText, fetchUnread } from "../lib/notifications";
import { CloseIcon, MenuIcon } from "./Icons";

const UNREAD_POLL_MS = 30000;

const LINKS = [
    { to: "/catalog", label: "Catálogo" },
    { to: "/upload", label: "Subir" },
    { to: "/my-songs", label: "Mis canciones" },
    { to: "/playlists", label: "Playlists" },
    { to: "/rooms", label: "Salas en vivo" },
    { to: "/metrics", label: "Métricas" },
    { to: "/notifications", label: "Avisos" },
    { to: "/profile", label: "Perfil" }
];

const ADMIN_LINK = { to: "/admin", label: "Admin" };

/** Avisos sin leer: se pide al entrar, cada 30 s y cuando la página de avisos marca alguno. */
function useUnread(pathname) {
    const [unread, setUnread] = useState(0);
    useEffect(() => {
        let alive = true;
        const load = () => fetchUnread().then((n) => alive && setUnread(n)).catch(() => {});
        load();
        const timer = setInterval(load, UNREAD_POLL_MS);
        const onChange = (e) => setUnread(e.detail);
        window.addEventListener(UNREAD_EVENT, onChange);
        return () => {
            alive = false;
            clearInterval(timer);
            window.removeEventListener(UNREAD_EVENT, onChange);
        };
    }, [pathname]);
    return unread;
}

function LinkLabel({ link, unread }) {
    if (link.to !== "/notifications" || unread === 0) return link.label;
    return (
        <>
            {link.label}
            <span className="sr-only">, {unread} sin leer</span>
            <span
                aria-hidden="true"
                className="ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center bg-black text-white text-xs font-bold tabular-nums ring-1 ring-white"
            >
                {badgeText(unread)}
            </span>
        </>
    );
}

const linkClass = ({ isActive }) =>
    `whitespace-nowrap px-2 xl:px-3 py-1 border ${isActive ? "border-black bg-black text-white" : "border-transparent hover:border-black"}`;

// En el celular cada link ocupa todo el ancho (fácil de tocar).
const mobileLinkClass = ({ isActive }) =>
    `block px-4 py-3 border-t border-black ${isActive ? "bg-black text-white" : "hover:bg-gray-100"}`;

/**
 * Celular: logo + botón de menú; los links se despliegan debajo.
 * Laptop (lg) o más grande: todo en una línea. En tablet los 8 links no entran, va el menú.
 */
export default function NavBar() {

    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const unread = useUnread(location.pathname);
    const links = currentRole() === "admin" ? [...LINKS, ADMIN_LINK] : LINKS;

    // Al cambiar de página, el menú se cierra.
    useEffect(() => {
        setOpen(false);
    }, [location.pathname]);

    function logout() {
        clearToken();
        navigate("/login");
    }

    return (
        <nav className="border-b border-black">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8 py-3">
                <span className="flex items-center gap-2 font-bold">
                    <img src="/tero.svg" alt="" className="h-7 w-7" />
                    TeroMusic
                </span>

                <div className="hidden lg:flex items-center gap-1 xl:gap-2">
                    {links.map((link) => (
                        <NavLink key={link.to} to={link.to} className={linkClass}>
                            <LinkLabel link={link} unread={unread} />
                        </NavLink>
                    ))}
                </div>

                <button onClick={logout} className="hidden lg:inline-flex ml-auto btn py-1 text-sm">
                    Salir
                </button>

                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-label={`${open ? "Cerrar menú" : "Abrir menú"}${unread > 0 ? ` (${unread} avisos sin leer)` : ""}`}
                    aria-expanded={open}
                    aria-controls="mobile-menu"
                    className="lg:hidden ml-auto -mr-2 btn-icon relative"
                >
                    {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
                    {!open && unread > 0 && (
                        <span aria-hidden="true" className="absolute top-1 right-1 h-2.5 w-2.5 bg-black ring-2 ring-white" />
                    )}
                </button>
            </div>

            {open && (
                <div id="mobile-menu" className="lg:hidden sm:grid sm:grid-cols-2">
                    {links.map((link) => (
                        <NavLink key={link.to} to={link.to} className={mobileLinkClass}>
                            <LinkLabel link={link} unread={unread} />
                        </NavLink>
                    ))}
                    <button onClick={logout} className="block w-full text-left px-4 py-3 border-t border-black hover:bg-gray-100 sm:col-span-2">
                        Salir
                    </button>
                </div>
            )}
        </nav>
    );
}
