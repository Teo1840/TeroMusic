import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useRoomSession } from "../lib/roomSession";
import RoomBar from "./RoomBar";

vi.mock("../lib/roomSession", () => ({ useRoomSession: vi.fn() }));

const NOW = 100_000;

function session(playback, extra = {}) {
    return {
        roomId: "r1",
        state: { room: { name: "Sala" }, playback },
        status: "open",
        fatal: null,
        send: vi.fn(),
        leave: vi.fn(),
        canControl: true,
        localPaused: false,
        resume: vi.fn(),
        blocked: false,
        unlockAudio: vi.fn(),
        muted: false,
        setMuted: vi.fn(),
        clockNow: NOW,
        serverNow: () => NOW,
        ...extra
    };
}

const song = { song_id: "s1", title: "Zamba", duration_sec: 60, updated_at_ms: NOW, position_ms: 0, playing: true };

function renderBar(path = "/catalog") {
    return render(<MemoryRouter initialEntries={[path]}><RoomBar /></MemoryRouter>);
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("RoomBar", () => {
    it("muestra la canción que suena", () => {
        useRoomSession.mockReturnValue(session(song));
        renderBar();
        expect(screen.getByText("Sonando: Zamba")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Pausar la sala" })).toBeTruthy();
    });

    it("si la canción terminó dice que no suena nada y no ofrece pausar", () => {
        useRoomSession.mockReturnValue(session({ ...song, playing: false, position_ms: 60_000 }));
        renderBar();
        expect(screen.getByText("No está sonando nada")).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Pausar|Reanudar/ })).toBeNull();
    });

    it("sin clockNow usa la hora del servidor", () => {
        // Arrancó hace 61 s y dura 60: ya terminó aunque el bucle todavía no haya redibujado.
        useRoomSession.mockReturnValue(session({ ...song, updated_at_ms: NOW - 61_000 }, { clockNow: 0 }));
        renderBar();
        expect(screen.getByText("No está sonando nada")).toBeTruthy();
    });

    it("no se muestra dentro de la propia sala", () => {
        useRoomSession.mockReturnValue(session(song));
        const { container } = renderBar("/rooms/r1");
        expect(container.innerHTML).toBe("");
    });
});
