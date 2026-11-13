import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Catalog from "./Catalog";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
// El reproductor hace sus propios pedidos; acá no interesa.
vi.mock("../components/AudioPlayer", () => ({ default: () => null }));

const songs = [
    { id: "1", title: "Zamba", artist_id: "b", artist_name: "Bruno", duration: 200 },
    { id: "2", title: "Alba", artist_id: "a", artist_name: "Ana", duration: 90 },
    { id: "3", title: "Brisa", artist_id: "a", artist_name: "Ana", duration: 150 }
];

const titles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

function renderCatalog() {
    return render(<MemoryRouter><Catalog /></MemoryRouter>);
}

describe("Catalog", () => {
    beforeEach(() => {
        api.get.mockReset();
    });

    it("muestra el resumen y ordena", async () => {
        api.get.mockResolvedValue({ data: songs });
        renderCatalog();
        expect(await screen.findByText("3 canciones · 2 artistas")).toBeTruthy();
        expect(titles()).toEqual(["Alba", "Brisa", "Zamba"]);

        fireEvent.change(screen.getByRole("combobox", { name: "Ordenar" }), { target: { value: "longest" } });
        expect(titles()).toEqual(["Zamba", "Brisa", "Alba"]);
    });

    it("no muestra selectores de artista", async () => {
        api.get.mockResolvedValue({ data: songs });
        renderCatalog();
        await screen.findByText("3 canciones · 2 artistas");
        expect(screen.queryByRole("group", { name: "Filtrar por artista" })).toBeNull();
    });

    it("filtra por artista desde la tarjeta y limpia filtros", async () => {
        api.get.mockResolvedValue({ data: songs });
        renderCatalog();
        await screen.findByText("3 canciones · 2 artistas");

        fireEvent.click(screen.getAllByTitle("Ver canciones de Ana")[0]);
        expect(titles()).toEqual(["Alba", "Brisa"]);

        fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
        expect(titles()).toHaveLength(3);
    });

    it("si falla deja reintentar", async () => {
        api.get.mockRejectedValueOnce(new Error("caído")).mockResolvedValue({ data: songs });
        renderCatalog();
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("3 canciones · 2 artistas")).toBeTruthy();
    });
});
