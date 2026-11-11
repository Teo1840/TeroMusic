import { Navigate } from "react-router-dom";
import NavBar from "./NavBar";


function isTokenExpired(token) {
    try {
        const payload = JSON.parse(
            atob(token.split(".")[1])
        );

        if (!payload.exp) {
            return true;
        }

        return payload.exp * 1000 < Date.now();

    } catch {
        return true;
    }
}


export default function ProtectedRoute({ children }) {

    const token = localStorage.getItem("access_token");

    if (!token || isTokenExpired(token)) {

        localStorage.removeItem("access_token");

        return (
            <Navigate
                to="/login"
                replace
            />
        );
    }

    return (
        <>
            <NavBar />
            {children}
        </>
    );
}