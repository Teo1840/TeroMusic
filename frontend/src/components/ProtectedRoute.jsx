import { Navigate } from "react-router-dom";
import { clearToken, hasValidToken } from "../lib/auth";
import NavBar from "./NavBar";
import NowPlayingBar from "./NowPlayingBar";
import RoomBar from "./RoomBar";

/** Pantallas que piden haber iniciado sesión. Sin token vigente, al login. */
export default function ProtectedRoute({ children }) {

    if (!hasValidToken()) {
        clearToken();
        return <Navigate to="/login" replace />;
    }

    return (
        <>
            <NavBar />
            <main>{children}</main>
            <NowPlayingBar />
            <RoomBar />
        </>
    );
}
