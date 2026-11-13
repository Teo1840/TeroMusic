import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import api from "../api/client";
import Metrics from "./Metrics";

vi.mock("../api/client", () => ({ default: { get: vi.fn() } }));

const DAYS = [
    { date: "2026-11-11", plays: 0 },
    { date: "2026-11-12", plays: 4 },
    { date: "2026-11-13", plays: 2 }
];

function mockApi({ plays = 0, top = [], songs = [], days = DAYS, trending = { plays: 0, previous_plays: 0, songs: [] } } = {}) {
    api.get.mockImplementation(async (url, config) => {
        if (url === "/metrics/plays") return { data: { plays } };
        if (url === "/metrics/top") return { data: { songs: top } };
        if (url === "/metrics/plays/daily") return { data: { days, total: days.reduce((s, d) => s + d.plays, 0), tz: "UTC" } };
        if (url === "/metrics/trending") return { data: { days: 7, ...trending } };
        if (url === "/catalog/songs") {
            const ids = config.params.ids.split(",");
            return { data: songs.filter((s) => ids.includes(s.id)) };
        }
        throw new Error(`URL inesperada: ${url}`);
    });
}

const topItems = () => within(screen.getByRole("heading", { name: "Las más escuchadas" }).closest("section")).getAllByRole("listitem");

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
        await screen.findByText("Zamba");
        const items = topItems();
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

    it("pide los nombres solo de las canciones del top y las tendencias", async () => {
        mockApi({
            top: [{ song_id: "a", total_plays: 2 }],
            trending: { plays: 3, previous_plays: 1, songs: [{ song_id: "b", plays: 3, previous_plays: 1 }] },
            songs: [{ id: "a", title: "Zamba" }, { id: "b", title: "Chacarera" }]
        });
        render(<Metrics />);

        await screen.findByText("Chacarera");
        const catalogCall = api.get.mock.calls.find(([u]) => u === "/catalog/songs");
        expect(catalogCall[1].params.ids.split(",").sort()).toEqual(["a", "b"]);
    });

    it("muestra la serie por día y cambia de período", async () => {
        mockApi();
        render(<Metrics />);

        expect(await screen.findByText("6 reproducciones en los últimos 30 días.")).toBeTruthy();
        expect(screen.getAllByTestId("day-column")).toHaveLength(3);
        const daily = api.get.mock.calls.find(([u]) => u === "/metrics/plays/daily");
        expect(daily[1].params.days).toBe(30);
        expect(typeof daily[1].params.tz).toBe("string");

        fireEvent.click(screen.getByRole("button", { name: "7 días" }));
        await waitFor(() => expect(api.get).toHaveBeenCalledWith("/metrics/plays/daily", expect.objectContaining({
            params: expect.objectContaining({ days: 7 })
        })));
        expect(screen.getByRole("button", { name: "7 días" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("al pasar el mouse por un día muestra la cantidad", async () => {
        mockApi();
        render(<Metrics />);

        const columns = await screen.findAllByTestId("day-column");
        fireEvent.mouseEnter(columns[1]);
        expect(screen.getByRole("status").textContent).toContain("4 reproducciones");
    });

    it("muestra las tendencias con el cambio contra la semana anterior", async () => {
        mockApi({
            trending: {
                plays: 10, previous_plays: 5,
                songs: [
                    { song_id: "a", plays: 6, previous_plays: 3 },
                    { song_id: "b", plays: 4, previous_plays: 0 }
                ]
            },
            songs: [{ id: "a", title: "Zamba" }, { id: "b", title: "Chacarera" }]
        });
        render(<Metrics />);

        const list = await screen.findByRole("list", { name: "Tendencias" });
        await within(list).findByText("Zamba");
        const items = within(list).getAllByRole("listitem");
        expect(items[0].textContent).toContain("+100 %");
        expect(items[1].textContent).toContain("nueva");
        expect(screen.getByText(/contra los 7 anteriores/).textContent).toContain("+100 %");
    });

    it("si la serie o las tendencias fallan, el total y el top se ven igual", async () => {
        mockApi({ plays: 7 });
        const base = api.get.getMockImplementation();
        api.get.mockImplementation((url, ...rest) =>
            url === "/metrics/plays/daily" || url === "/metrics/trending" ? Promise.reject(new Error("caído")) : base(url, ...rest)
        );
        render(<Metrics />);

        expect(await screen.findByText("7")).toBeTruthy();
        expect(screen.getByText("No se pudo cargar la serie por día.")).toBeTruthy();
        expect(screen.getByText("No se pudieron cargar las tendencias.")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("explica que el top está vacío si nadie escuchó nada", async () => {
        mockApi();
        render(<Metrics />);

        expect(await screen.findByText(/Todavía nadie terminó de escuchar/)).toBeTruthy();
    });

    describe("actualización automática", () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        const calls = (url) => api.get.mock.calls.filter(([u]) => u === url).length;

        it("vuelve a pedir las métricas cada 5 segundos", async () => {
            mockApi({ plays: 1 });
            render(<Metrics />);
            await vi.advanceTimersByTimeAsync(0);
            expect(calls("/metrics/plays")).toBe(1);

            await vi.advanceTimersByTimeAsync(5000);
            expect(calls("/metrics/plays")).toBe(2);
        });

        it("deja de pedir al salir de la página, aunque haya un pedido en vuelo", async () => {
            let release;
            mockApi({ plays: 1 });
            const base = api.get.getMockImplementation();
            api.get.mockImplementation((url, ...rest) =>
                url === "/metrics/plays" ? new Promise((r) => { release = () => r({ data: { plays: 1 } }); }) : base(url, ...rest)
            );
            const { unmount } = render(<Metrics />);
            await vi.advanceTimersByTimeAsync(0);
            expect(calls("/metrics/plays")).toBe(1);

            unmount();
            release();
            await vi.advanceTimersByTimeAsync(30000);
            expect(calls("/metrics/plays")).toBe(1);
        });

        it("una canción borrada en el top no recarga el catálogo en cada vuelta", async () => {
            mockApi({ plays: 3, top: [{ song_id: "borrada", total_plays: 3 }] });
            render(<Metrics />);
            await vi.advanceTimersByTimeAsync(0);
            const afterFirst = calls("/catalog/songs");

            await vi.advanceTimersByTimeAsync(15000);
            expect(calls("/metrics/plays")).toBe(4);
            expect(calls("/catalog/songs")).toBe(afterFirst);
        });
    });

    it("muestra el error si metrics_service no responde", async () => {
        api.get.mockImplementation(async () => {
            throw new Error("caído");
        });
        render(<Metrics />);

        expect((await screen.findByRole("alert")).textContent).toBe("No se pudieron cargar las métricas.");
    });
});
