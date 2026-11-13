import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NavBar from "./NavBar";
import { currentRole } from "../lib/auth";
import { UNREAD_EVENT, badgeText, fetchUnread } from "../lib/notifications";

vi.mock("../lib/auth", () => ({ clearToken: vi.fn(), currentRole: vi.fn(() => "user") }));
vi.mock("../lib/notifications", async (original) => ({ ...(await original()), fetchUnread: vi.fn() }));

beforeEach(() => {
    vi.clearAllMocks();
    currentRole.mockReturnValue("user");
});

const renderNav = () => render(<MemoryRouter><NavBar /></MemoryRouter>);

describe("NavBar", () => {
    it("muestra cuántos avisos hay sin leer y se actualiza al marcarlos", async () => {
        fetchUnread.mockResolvedValue(3);
        renderNav();
        expect(await screen.findByText(", 3 sin leer")).toBeTruthy();

        act(() => window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: 0 })));
        expect(screen.queryByText(/sin leer/)).toBeNull();
    });

    it("sin avisos no muestra contador, y si falla tampoco", async () => {
        fetchUnread.mockRejectedValue(new Error("caído"));
        renderNav();
        await act(async () => {});
        expect(screen.queryByText(/sin leer/)).toBeNull();
    });

    it("el link de admin solo aparece para administradores", async () => {
        fetchUnread.mockResolvedValue(0);
        renderNav();
        expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();

        currentRole.mockReturnValue("admin");
        renderNav();
        expect(screen.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin");
        await act(async () => {});
    });

    it("el globito no pasa de 9+", () => {
        expect(badgeText(4)).toBe("4");
        expect(badgeText(10)).toBe("9+");
    });
});
