import { NavLink, useNavigate } from "react-router-dom";

const linkClass = ({ isActive }) =>
    isActive ? "font-semibold underline" : "hover:underline";

export default function NavBar() {

    const navigate = useNavigate();

    function logout() {
        localStorage.removeItem("access_token");
        navigate("/login");
    }

    return (
        <nav className="flex items-center gap-6 px-8 py-3 border-b">
            <span className="font-bold">TeroMusic</span>
            <NavLink to="/catalog" className={linkClass}>Catálogo</NavLink>
            <NavLink to="/rooms" className={linkClass}>Salas en vivo</NavLink>
            <NavLink to="/metrics" className={linkClass}>Métricas</NavLink>
            <button onClick={logout} className="ml-auto text-sm hover:underline">
                Salir
            </button>
        </nav>
    );
}
