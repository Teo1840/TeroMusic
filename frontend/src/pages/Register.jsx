import AuthForm from "../components/AuthForm";

export default function Register() {
    return (
        <AuthForm
            title="Crear cuenta"
            endpoint="/auth/register"
            submitLabel="Registrarse"
            busyLabel="Registrando..."
            statusMessages={{ 409: "Ya existe una cuenta con ese email." }}
            askDisplayName
            footer={{ text: "¿Ya tenés cuenta?", link: "Iniciar sesión", to: "/login" }}
        />
    );
}
