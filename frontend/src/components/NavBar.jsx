import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { clearToken } from "../lib/auth";
import { CloseIcon, MenuIcon } from "./Icons";

const LINKS = [
    { to: "/catalog", label: "Catálogo" },
    { to: "/upload", label: "Subir" },
    { to: "/rooms", label: "Salas en vivo" },
    { to: "/metrics", label: "Métricas" }
];

const linkClass = ({ isActive }) =>
    `px-3 py-1 border ${isActive ? "border-black bg-black text-white" : "border-transparent hover:border-black"}`;

// En el celular cada link ocupa todo el ancho (fácil de tocar).
const mobileLinkClass = ({ isActive }) =>
    `block px-4 py-3 border-t border-black ${isActive ? "bg-black text-white" : "hover:bg-gray-100"}`;

/**
 * Celular: logo + botón de menú; los links se despliegan debajo.
 * Pantalla mediana o más grande (md): todo en una línea.
 */
export default function NavBar() {

    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);

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
            <div className="flex items-center gap-6 px-4 md:px-8 py-3">
                <span className="flex items-center gap-2 font-bold">
                    <img src="/tero.svg" alt="" className="h-7 w-7" />
                    TeroMusic
                </span>

                <div className="hidden md:flex items-center gap-2">
                    {LINKS.map((link) => (
                        <NavLink key={link.to} to={link.to} className={linkClass}>
                            {link.label}
                        </NavLink>
                    ))}
                </div>

                <button onClick={logout} className="hidden md:inline-flex ml-auto btn py-1 text-sm">
                    Salir
                </button>

                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-label={open ? "Cerrar menú" : "Abrir menú"}
                    aria-expanded={open}
                    aria-controls="mobile-menu"
                    className="md:hidden ml-auto -mr-2 btn-icon"
                >
                    {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
                </button>
            </div>

            {open && (
                <div id="mobile-menu" className="md:hidden">
                    {LINKS.map((link) => (
                        <NavLink key={link.to} to={link.to} className={mobileLinkClass}>
                            {link.label}
                        </NavLink>
                    ))}
                    <button onClick={logout} className="block w-full text-left px-4 py-3 border-t border-black hover:bg-gray-100">
                        Salir
                    </button>
                </div>
            )}
        </nav>
    );
}
