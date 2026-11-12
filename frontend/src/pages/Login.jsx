import AuthForm from "../components/AuthForm";

export default function Login() {
    return (
        <AuthForm
            title="Iniciar sesión"
            endpoint="/auth/login"
            submitLabel="Iniciar sesión"
            busyLabel="Ingresando..."
            statusMessages={{ 401: "Email o contraseña incorrectos." }}
            footer={{ text: "¿No tenés cuenta?", link: "Registrarse", to: "/register" }}
        />
    );
}
