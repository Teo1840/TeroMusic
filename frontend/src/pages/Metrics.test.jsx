import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import api from "../api/client";
import Metrics from "./Metrics";

vi.mock("../api/client", () => ({ default: { get: vi.fn() } }));

function mockApi({ plays = 0, top = [], songs = [] } = {}) {
    api.get.mockImplementation(async (url) => {
        if (url === "/metrics/plays") return { data: { plays } };
        if (url === "/metrics/top") return { data: { songs: top } };
        if (url === "/catalog/songs") return { data: songs };
        throw new Error(`URL inesperada: ${url}`);
    });
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("Metrics", () => {
    it("muestra el total y el top con título, artista y reproducciones", async () => {
        mockApi({
            plays: 15,
            top: [{ song_id: "a", total_plays: 12 }, { song_id: "b", total_plays: 1 }],
            songs: [
                { id: "a", title: "Zamba", artist_name: "Tero" },
                { id: "b", title: "Chacarera", artist_name: null }
            ]
        });
        render(<Metrics />);

        expect(await screen.findByText("15")).toBeTruthy();
        const items = screen.getAllByRole("listitem");
        expect(within(items[0]).getByText("Zamba")).toBeTruthy();
        expect(within(items[0]).getByText("Tero")).toBeTruthy();
        expect(within(items[0]).getByText("12 reproducciones")).toBeTruthy();
        expect(within(items[1]).getByText("Artista desconocido")).toBeTruthy();
        expect(within(items[1]).getByText("1 reproducción")).toBeTruthy();
    });

    it("marca las canciones que ya no están en el catálogo", async () => {
        mockApi({ plays: 3, top: [{ song_id: "borrada", total_plays: 3 }] });
        render(<Metrics />);

        expect(await screen.findByText("Canción no disponible")).toBeTruthy();
    });

    it("explica que el top está vacío si nadie escuchó nada", async () => {
        mockApi();
        render(<Metrics />);

        expect(await screen.findByText(/Todavía nadie terminó de escuchar/)).toBeTruthy();
    });

    it("muestra el error si metrics_service no responde", async () => {
        api.get.mockImplementation(async (url) => {
            if (url === "/catalog/songs") return { data: [] };
            throw new Error("caído");
        });
        render(<Metrics />);

        expect((await screen.findByRole("alert")).textContent).toBe("No se pudieron cargar las métricas.");
    });
});
