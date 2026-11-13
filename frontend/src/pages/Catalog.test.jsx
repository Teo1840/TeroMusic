import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Catalog from "./Catalog";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// El reproductor hace sus propios pedidos; acá no interesa.
vi.mock("../components/AudioPlayer", () => ({ default: () => null }));

const song = (id, title, artist = "Ana") => ({ id, title, artist_id: artist.toLowerCase(), artist_name: artist, duration: 100 });

const titles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
const lastParams = () => api.get.mock.calls.at(-1)[1].params;

/** Simula GET /catalog/songs: devuelve `pages[offset]` y el total en X-Total-Count. */
function mockSongs(pages, total) {
    api.get.mockImplementation(async (url, { params }) => ({
        data: pages[params.offset] ?? [],
        headers: { "x-total-count": String(total) }
    }));
}

function renderCatalog() {
    return render(<MemoryRouter><Catalog /></MemoryRouter>);
}

describe("Catalog", () => {
    beforeEach(() => vi.resetAllMocks());

    it("pide la primera página ordenada por título y muestra el total", async () => {
        mockSongs({ 0: [song("1", "Alba"), song("2", "Brisa")] }, 2);
        renderCatalog();
        expect(await screen.findByText("Mostrando 2 de 2 canciones")).toBeTruthy();
        expect(titles()).toEqual(["Alba", "Brisa"]);
        expect(api.get).toHaveBeenCalledWith("/catalog/songs", { params: { sort: "title", limit: 50, offset: 0 } });
        expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    });

    it("carga más páginas con offset hasta llegar al total", async () => {
        const first = Array.from({ length: 50 }, (_, i) => song(`a${i}`, `Tema ${i}`));
        mockSongs({ 0: first, 50: [song("z", "Último")] }, 51);
        renderCatalog();
        expect(await screen.findByText("Mostrando 50 de 51 canciones")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
        expect(await screen.findByText("Mostrando 51 de 51 canciones")).toBeTruthy();
        expect(lastParams()).toEqual({ sort: "title", limit: 50, offset: 50 });
        expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    });

    it("el orden y la búsqueda se mandan al server", async () => {
        mockSongs({ 0: [song("1", "Alba")] }, 1);
        renderCatalog();
        await screen.findByText("Mostrando 1 de 1 canción");

        fireEvent.change(screen.getByRole("combobox", { name: "Ordenar" }), { target: { value: "newest" } });
        await waitFor(() => expect(lastParams()).toEqual({ sort: "newest", limit: 50, offset: 0 }));

        fireEvent.change(screen.getByRole("searchbox"), { target: { value: " ana " } });
        await waitFor(() => expect(lastParams()).toEqual({ q: "ana", sort: "newest", limit: 50, offset: 0 }));
        expect(await screen.findByText(/1 resultado/)).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
        await waitFor(() => expect(lastParams().q).toBeUndefined());
    });

    it("una búsqueda sin resultados deja el buscador a mano", async () => {
        api.get.mockImplementation(async (url, { params }) => (params.q
            ? { data: [], headers: { "x-total-count": "0" } }
            : { data: [song("1", "Alba")], headers: { "x-total-count": "1" } }));
        renderCatalog();
        await screen.findByText("Mostrando 1 de 1 canción");
        fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nada" } });
        expect(await screen.findByText("Ninguna canción coincide con la búsqueda.")).toBeTruthy();
        expect(screen.getByRole("searchbox")).toBeTruthy();
    });

    it("el nombre del artista lleva a su página", async () => {
        mockSongs({ 0: [song("1", "Alba"), song("2", "Brisa", "Bruno")] }, 2);
        renderCatalog();
        const link = await screen.findByRole("link", { name: "Bruno" });
        expect(link.getAttribute("href")).toBe("/artists/bruno");
    });

    it("catálogo vacío invita a subir", async () => {
        mockSongs({}, 0);
        renderCatalog();
        expect(await screen.findByText("Todavía no hay canciones.")).toBeTruthy();
    });

    it("si falla deja reintentar", async () => {
        mockSongs({ 0: [song("1", "Alba")] }, 1);
        api.get.mockRejectedValueOnce(new Error("caído"));
        renderCatalog();
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Mostrando 1 de 1 canción")).toBeTruthy();
    });
});
