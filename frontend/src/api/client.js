import axios from "axios";
import { clearToken, getToken } from "../lib/auth";

// Todo pasa por el gateway: Vite reenvía /api al nginx.
const api = axios.create({
    baseURL: "/api/v1"
});

api.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Sesión vencida o inválida: volver al login.
        // Login y registro responden 401 por contraseña mal: ese error lo muestra el formulario.
        const isAuthRequest = error.config?.url?.startsWith("/auth/");
        if (error.response?.status === 401 && !isAuthRequest) {
            clearToken();
            window.location.href = "/login";
        }
        return Promise.reject(error);
    }
);

export default api;
