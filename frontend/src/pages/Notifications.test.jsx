import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Notifications from "./Notifications";
import { UNREAD_EVENT } from "../lib/notifications";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
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

    it("distingue las sin leer y marca una o todas", async () => {
        api.get.mockResolvedValue({ data: [
            notification(2, "audio.ready.v1", "nueva"),
            notification(1, "user.registered.v1", "vieja", { read_at: "2026-11-13T12:05:00Z" })
        ] });
        api.post.mockResolvedValue({ data: { unread: 0 } });
        const heard = [];
        const listener = (e) => heard.push(e.detail);
        window.addEventListener(UNREAD_EVENT, listener);
        renderPage();

        const items = await screen.findAllByRole("listitem");
        expect(within(items[0]).getByText("Nuevo")).toBeTruthy();
        expect(within(items[1]).queryByText("Nuevo")).toBeNull();

        fireEvent.click(within(items[0]).getByRole("button", { name: "Marcar como leída" }));
        await waitFor(() => expect(within(items[0]).queryByText("Nuevo")).toBeNull());
        expect(api.post).toHaveBeenCalledWith("/notifications/user/user-1/read", { ids: [2] });
        expect(heard).toEqual([0]);
        expect(screen.queryByRole("button", { name: "Marcar todas como leídas" })).toBeNull();
        window.removeEventListener(UNREAD_EVENT, listener);
    });

    it("marcar todas manda el pedido sin ids", async () => {
        api.get.mockResolvedValue({ data: [notification(2, "audio.ready.v1", "a"), notification(1, "audio.ready.v1", "b")] });
        api.post.mockResolvedValue({ data: { unread: 0 } });
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Marcar todas como leídas" }));
        await waitFor(() => expect(screen.queryAllByText("Nuevo")).toHaveLength(0));
        expect(api.post).toHaveBeenCalledWith("/notifications/user/user-1/read", {});
    });

    it("si marcar falla muestra el error y siguen sin leer", async () => {
        api.get.mockResolvedValue({ data: [notification(1, "audio.ready.v1", "a")] });
        api.post.mockRejectedValue({ response: { status: 503 } });
        renderPage();

        fireEvent.click(await screen.findByRole("button", { name: "Marcar todas como leídas" }));
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(screen.getByText("Nuevo")).toBeTruthy();
    });
});
