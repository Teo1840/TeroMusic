import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Profile from "./Profile";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), patch: vi.fn() } }));

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

function mockApi({ mine = songs, metricsFail = false } = {}) {
    api.get.mockImplementation(async (url) => {
        if (url === "/auth/me") return { data: me };
        if (url === "/catalog/songs/mine") return { data: mine };
        if (url === "/catalog/playlists") return { data: [{ id: "p1" }, { id: "p2" }] };
        const m = url.match(/^\/metrics\/songs\/(.+)$/);
        if (m) {
            if (metricsFail) throw new Error("metrics caído");
            return { data: { song_id: m[1], total_plays: PLAYS[m[1]] ?? 0 } };
        }
        throw new Error(`URL inesperada: ${url}`);
    });
}

function renderProfile() {
    return render(<MemoryRouter><Profile /></MemoryRouter>);
}

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
        // Solo pide métricas de las publicadas.
        expect(api.get).not.toHaveBeenCalledWith("/metrics/songs/s3");
    });

    it("si metrics no responde, el resto se ve igual", async () => {
        mockApi({ metricsFail: true });
        renderProfile();
        await screen.findByRole("heading", { level: 1, name: "Ana López" });
        await vi.waitFor(() => expect(within(stat("Reproducciones")).getByText("–")).toBeTruthy());
        expect(within(stat("Canciones publicadas")).getByText("2")).toBeTruthy();
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
});
