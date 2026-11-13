import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Notifications from "./Notifications";

vi.mock("../api/client", () => ({ default: { get: vi.fn() } }));
vi.mock("../lib/auth", () => ({ currentUserId: vi.fn(() => "user-1") }));

function notification(id, type, message, extra = {}) {
    return { id, event_id: `e${id}`, user_id: "user-1", type, message,
             resource_id: null, created_at: "2026-11-13T12:00:00Z", received_at: "2026-11-13T12:00:01Z", ...extra };
}

function renderPage() {
    return render(<MemoryRouter><Notifications /></MemoryRouter>);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("Notifications", () => {
    it("pide las del usuario del token y las muestra con su tipo y un link", async () => {
        api.get.mockResolvedValue({ data: [
            notification(3, "audio.ready.v1", "Tu audio está listo para reproducir."),
            notification(2, "room.created.v1", "Tu sala Viernes fue creada.", { resource_id: "sala-9" }),
            notification(1, "user.registered.v1", "¡Bienvenido a TeroMusic, Ana!")
        ] });
        renderPage();

        const items = await screen.findAllByRole("listitem");
        expect(api.get).toHaveBeenCalledWith("/notifications/user/user-1", { params: { limit: 20, offset: 0 } });
        expect(within(items[0]).getByText("Canción lista")).toBeTruthy();
        expect(within(items[0]).getByRole("link").getAttribute("href")).toBe("/my-songs");
        expect(within(items[1]).getByRole("link").getAttribute("href")).toBe("/rooms/sala-9");
        expect(within(items[2]).getByText("¡Bienvenido a TeroMusic, Ana!")).toBeTruthy();
        expect(within(items[2]).queryByRole("link")).toBeNull();
    });

    it("avisa si no hay notificaciones", async () => {
        api.get.mockResolvedValue({ data: [] });
        renderPage();

        expect(await screen.findByText("Todavía no tenés notificaciones.")).toBeTruthy();
    });

    it("muestra el error si el servicio no responde", async () => {
        api.get.mockRejectedValue({ response: { status: 503, data: { detail: "Database unavailable" } } });
        renderPage();

        expect(await screen.findByRole("alert")).toBeTruthy();
    });

    it("con una página llena ofrece ver más y trae la siguiente", async () => {
        const first = Array.from({ length: 20 }, (_, i) => notification(100 - i, "audio.ready.v1", `aviso ${i}`));
        api.get
            .mockResolvedValueOnce({ data: first })
            .mockResolvedValueOnce({ data: [notification(1, "user.registered.v1", "el más viejo")] });
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));

        expect(await screen.findByText("el más viejo")).toBeTruthy();
        expect(api.get).toHaveBeenLastCalledWith("/notifications/user/user-1", { params: { limit: 20, offset: 20 } });
        expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
    });
});
