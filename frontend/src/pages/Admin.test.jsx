import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Admin from "./Admin";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock("../lib/auth", () => ({ currentUserId: vi.fn(() => "u-jefa") }));

const JEFA = { id: "u-jefa", email: "jefa@tero.com", display_name: "Jefa", role: "admin", created_at: "2026-11-01T00:00:00Z" };
const ANA = { id: "u-ana", email: "ana@tero.com", display_name: "Ana", role: "user", created_at: "2026-11-02T00:00:00Z" };
const SONG = { id: "s-1", title: "Tema ajeno", artist_id: "u-ana", artist_name: "Ana", duration: 125 };

function mockGets({ users = [JEFA, ANA], songs = [SONG] } = {}) {
    api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith("/auth/admin/users") ? users : songs }));
}

function renderPage() {
    return render(<MemoryRouter><Admin /></MemoryRouter>);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("Admin", () => {
    it("lista las cuentas y marca la propia", async () => {
        mockGets();
        renderPage();
        const users = screen.getByRole("region", { name: "Cuentas" });
        expect(await within(users).findByText("ana@tero.com · Usuario")).toBeTruthy();
        expect(within(users).getByText("(vos)")).toBeTruthy();
    });

    it("cambia el rol y muestra el resultado", async () => {
        mockGets();
        api.patch.mockResolvedValue({ data: { ...ANA, role: "admin" } });
        renderPage();
        const users = screen.getByRole("region", { name: "Cuentas" });
        fireEvent.click(await within(users).findAllByRole("button", { name: "Hacer admin" }).then((b) => b[0]));

        expect(api.patch).toHaveBeenCalledWith("/auth/admin/users/u-ana/role", { role: "admin" });
        expect(await screen.findByText("Ana ahora es admin.")).toBeTruthy();
    });

    it("avisa cuando no se puede sacar al último admin", async () => {
        mockGets({ users: [JEFA] });
        api.patch.mockRejectedValue({ response: { status: 409, data: { detail: "x" } } });
        renderPage();
        fireEvent.click(await screen.findByRole("button", { name: "Quitar admin" }));
        expect(await screen.findByText("Tiene que quedar al menos un administrador.")).toBeTruthy();
    });

    it("borra una canción de otro después de confirmar", async () => {
        mockGets();
        api.delete.mockResolvedValue({ status: 204 });
        renderPage();
        const songs = screen.getByRole("region", { name: "Canciones" });
        fireEvent.click(await within(songs).findByRole("button", { name: "Borrar" }));
        fireEvent.click(within(songs).getByRole("button", { name: "Sí, borrar" }));

        expect(api.delete).toHaveBeenCalledWith("/catalog/songs/s-1");
        expect(await screen.findByText('"Tema ajeno" se borró.')).toBeTruthy();
        expect(within(songs).queryByText("Tema ajeno")).toBeNull();
    });
});
