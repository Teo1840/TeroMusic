import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../api/client";
import Profile from "./Profile";
import { clearToken, saveToken } from "../lib/auth";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../lib/auth", () => ({ saveToken: vi.fn(), clearToken: vi.fn() }));

const me = {
    id: "u1",
    email: "ana@example.com",
    username: "ana",
    display_name: "Ana López",
    role: "user",
    created_at: "2026-03-15T12:00:00Z"
};

const songs = [
    { id: "s1", title: "Hit", status: "PUBLICADO" },
    { id: "s2", title: "Otra", status: "PUBLICADO" },
    { id: "s3", title: "Subiendo", status: "BORRADOR" },
    { id: "s4", title: "Rota", status: "FALLIDO" }
];

const PLAYS = { s1: 12, s2: 3 };

function mockApi({ mine = songs, metricsFail = false, plays = PLAYS } = {}) {
    api.get.mockImplementation(async (url) => {
        if (url === "/auth/me") return { data: me };
        if (url === "/catalog/songs/mine") return { data: mine };
        if (url === "/catalog/playlists") return { data: [{ id: "p1" }, { id: "p2" }] };
        throw new Error(`URL inesperada: ${url}`);
    });
    api.post.mockImplementation(async (url, body) => {
        if (url === "/metrics/songs/daily") {
            if (metricsFail) throw new Error("metrics caído");
            return { data: { days: [{ date: "2026-11-12", plays: 1 }, { date: "2026-11-13", plays: 4 }], total: 5, tz: "UTC" } };
        }
        if (url !== "/metrics/songs/batch") throw new Error(`URL inesperada: ${url}`);
        if (metricsFail) throw new Error("metrics caído");
        return { data: { songs: body.song_ids.map((id) => ({ song_id: id, total_plays: plays[id] ?? 0 })) } };
    });
}

function renderProfile() {
    return render(
        <MemoryRouter initialEntries={["/profile"]}>
            <Routes>
                <Route path="/profile" element={<Profile />} />
                <Route path="/login" element={<p>Pantalla de login</p>} />
            </Routes>
        </MemoryRouter>
    );
}

const batchCalls = () => api.post.mock.calls.filter(([url]) => url === "/metrics/songs/batch");

function stat(label) {
    return screen.getByText(label).closest(".card");
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("perfil", () => {
    it("muestra la cabecera con nombre, usuario, iniciales y fecha de alta", async () => {
        mockApi();
        renderProfile();
        expect(await screen.findByRole("heading", { level: 1, name: "Ana López" })).toBeTruthy();
        expect(screen.getAllByText("@ana").length).toBeGreaterThan(0);
        expect(screen.getByText("AL")).toBeTruthy();
        expect(screen.getByText(/Miembro desde marzo de 2026/i)).toBeTruthy();
    });

    it("resume canciones, playlists y reproducciones", async () => {
        mockApi();
        renderProfile();
        expect(await screen.findByText("15")).toBeTruthy();

        expect(within(stat("Canciones publicadas")).getByText("2")).toBeTruthy();
        expect(within(stat("Canciones publicadas")).getByText("1 procesando · 1 fallida")).toBeTruthy();
        expect(within(stat("Playlists")).getByText("2")).toBeTruthy();
        expect(within(stat("Más escuchada")).getByText("Hit")).toBeTruthy();
        expect(within(stat("Más escuchada")).getByText("12 reproducciones")).toBeTruthy();
        // Un solo pedido a metrics, solo con las publicadas.
        expect(batchCalls()).toEqual([["/metrics/songs/batch", { song_ids: ["s1", "s2"] }]]);
    });

    it("con más de 500 canciones parte el pedido y suma todo", async () => {
        const many = Array.from({ length: 1201 }, (_, i) => ({ id: `m${i}`, title: `T${i}`, status: "PUBLICADO" }));
        mockApi({ mine: many, plays: { m0: 1, m700: 5, m1200: 2 } });
        renderProfile();

        await vi.waitFor(() => expect(within(stat("Reproducciones")).getByText("8")).toBeTruthy());
        expect(within(stat("Más escuchada")).getByText("T700")).toBeTruthy();
        expect(batchCalls().map(([, body]) => body.song_ids.length)).toEqual([500, 500, 201]);
    });

    it("si metrics no responde, el resto se ve igual", async () => {
        mockApi({ metricsFail: true });
        renderProfile();
        await screen.findByRole("heading", { level: 1, name: "Ana López" });
        await vi.waitFor(() => expect(within(stat("Reproducciones")).getByText("–")).toBeTruthy());
        expect(within(stat("Canciones publicadas")).getByText("2")).toBeTruthy();
    });

    it("si fallan las playlists o mis canciones, cada bloque muestra – por separado", async () => {
        mockApi();
        const base = api.get.getMockImplementation();
        api.get.mockImplementation(async (url) => {
            if (url === "/catalog/playlists" || url === "/catalog/songs/mine") throw new Error("caído");
            return base(url);
        });
        renderProfile();
        await screen.findByRole("heading", { level: 1, name: "Ana López" });
        await vi.waitFor(() => expect(within(stat("Playlists")).getByText("–")).toBeTruthy());
        expect(within(stat("Canciones publicadas")).getByText("–")).toBeTruthy();
        expect(within(stat("Reproducciones")).getByText("–")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("si falla /auth/me muestra el error", async () => {
        mockApi();
        const base = api.get.getMockImplementation();
        api.get.mockImplementation(async (url) => {
            if (url === "/auth/me") throw new Error("caído");
            return base(url);
        });
        renderProfile();
        expect((await screen.findByRole("alert")).textContent).toBe("No se pudo cargar tu perfil.");
    });

    it("si falla guardar el nombre muestra el error y no cambia la cabecera", async () => {
        mockApi();
        api.patch.mockRejectedValue(new Error("caído"));
        renderProfile();
        const input = await screen.findByLabelText("Nombre de artista");

        fireEvent.change(input, { target: { value: "Ana Nueva" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByRole("heading", { level: 1, name: "Ana López" })).toBeTruthy();
    });

    it("sin canciones invita a subir la primera", async () => {
        mockApi({ mine: [] });
        renderProfile();
        expect(await screen.findByRole("link", { name: "Subí la primera" })).toBeTruthy();
        expect(within(stat("Reproducciones")).getByText("0")).toBeTruthy();
    });

    it("guarda el nombre y actualiza la cabecera", async () => {
        mockApi();
        api.patch.mockResolvedValue({ data: { ...me, display_name: "Ana Nueva" } });
        renderProfile();
        const input = await screen.findByLabelText("Nombre de artista");

        fireEvent.change(input, { target: { value: "  Ana Nueva " } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

        expect(await screen.findByRole("heading", { level: 1, name: "Ana Nueva" })).toBeTruthy();
        expect(api.patch).toHaveBeenCalledWith("/auth/me", { display_name: "Ana Nueva" });
        expect(screen.getByRole("status").textContent).toMatch(/Listo/);
    });

    it("Cancelar vuelve al nombre guardado", async () => {
        mockApi();
        renderProfile();
        const input = await screen.findByLabelText("Nombre de artista");

        expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
        fireEvent.change(input, { target: { value: "Otro" } });
        fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

        expect(input.value).toBe("Ana López");
        expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
    });

    it("muestra tus reproducciones por día con las canciones publicadas", async () => {
        mockApi();
        renderProfile();
        expect(await screen.findByText("5 en los últimos 30 días, sumando todas tus canciones.")).toBeTruthy();
        const daily = api.post.mock.calls.find(([url]) => url === "/metrics/songs/daily");
        expect(daily[1]).toMatchObject({ song_ids: ["s1", "s2"], days: 30 });
    });

    it("sin canciones publicadas no muestra el gráfico", async () => {
        mockApi({ mine: [] });
        renderProfile();
        await screen.findByRole("link", { name: "Subí la primera" });
        expect(screen.queryByText("Tus reproducciones por día")).toBeNull();
    });
});

describe("contraseña", () => {
    async function fill(current, next, repeat = next) {
        fireEvent.change(await screen.findByLabelText("Contraseña actual"), { target: { value: current } });
        fireEvent.change(screen.getByLabelText("Contraseña nueva"), { target: { value: next } });
        fireEvent.change(screen.getByLabelText("Repetí la contraseña nueva"), { target: { value: repeat } });
    }

    it("la cambia y guarda el token nuevo", async () => {
        mockApi();
        const base = api.post.getMockImplementation();
        api.post.mockImplementation(async (url, body) =>
            url === "/auth/me/password" ? { data: { access_token: "nuevo" } } : base(url, body));
        renderProfile();

        await fill("vieja-clave", "nueva-clave-1");
        fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

        expect(await screen.findByText(/Cambiaste tu contraseña/)).toBeTruthy();
        expect(api.post).toHaveBeenCalledWith("/auth/me/password", { current_password: "vieja-clave", new_password: "nueva-clave-1" });
        expect(saveToken).toHaveBeenCalledWith("nuevo");
        expect(screen.getByLabelText("Contraseña actual").value).toBe("");
    });

    it("no deja mandar si no coinciden o es corta", async () => {
        mockApi();
        renderProfile();

        await fill("vieja-clave", "nueva-clave-1", "otra-cosa");
        expect(screen.getByText("Las dos contraseñas nuevas no coinciden.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Cambiar contraseña" }).disabled).toBe(true);

        await fill("vieja-clave", "corta");
        expect(screen.getByText(/al menos 8 caracteres/)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Cambiar contraseña" }).disabled).toBe(true);
    });

    it("con la actual mal muestra el error del server", async () => {
        mockApi();
        const base = api.post.getMockImplementation();
        api.post.mockImplementation(async (url, body) => {
            if (url === "/auth/me/password") {
                throw { response: { status: 403, data: { detail: "La contraseña actual no es correcta" } } };
            }
            return base(url, body);
        });
        renderProfile();

        await fill("mal", "nueva-clave-1");
        fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

        expect((await screen.findByRole("alert")).textContent).toBe("La contraseña actual no es correcta");
        expect(saveToken).not.toHaveBeenCalled();
    });
});

describe("borrar cuenta", () => {
    it("pide la contraseña, borra, cierra la sesión y va al login", async () => {
        mockApi();
        api.delete.mockResolvedValue({ status: 204 });
        renderProfile();

        fireEvent.click(await screen.findByRole("button", { name: "Quiero borrar mi cuenta" }));
        const submit = screen.getByRole("button", { name: "Borrar mi cuenta para siempre" });
        expect(submit.disabled).toBe(true);
        fireEvent.change(screen.getByLabelText("Escribí tu contraseña para confirmar"), { target: { value: "mi-clave" } });
        fireEvent.click(submit);

        expect(await screen.findByText("Pantalla de login")).toBeTruthy();
        expect(api.delete).toHaveBeenCalledWith("/auth/me", { data: { password: "mi-clave" } });
        expect(clearToken).toHaveBeenCalled();
    });

    it("si la contraseña está mal no cierra la sesión", async () => {
        mockApi();
        api.delete.mockRejectedValue({ response: { status: 403, data: { detail: "La contraseña actual no es correcta" } } });
        renderProfile();

        fireEvent.click(await screen.findByRole("button", { name: "Quiero borrar mi cuenta" }));
        fireEvent.change(screen.getByLabelText("Escribí tu contraseña para confirmar"), { target: { value: "mal" } });
        fireEvent.click(screen.getByRole("button", { name: "Borrar mi cuenta para siempre" }));

        expect((await screen.findByRole("alert")).textContent).toBe("La contraseña actual no es correcta");
        expect(clearToken).not.toHaveBeenCalled();
        expect(screen.queryByText("Pantalla de login")).toBeNull();
    });
});
