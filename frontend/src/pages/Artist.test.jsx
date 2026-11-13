import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../api/client";
import Artist from "./Artist";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../components/AudioPlayer", () => ({ default: () => null }));

const ID = "5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60";
const songs = [
    { id: "1", title: "Zamba", artist_id: ID, artist_name: "Ana", duration: 200 },
    { id: "2", title: "Alba", artist_id: ID, artist_name: "Ana", duration: 90 }
];
const profile = { id: ID, username: "ana", display_name: "Ana y los Teros", song_count: 2 };

const titles = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

/** Perfil y canciones; el server ordena: acá se simula con la duración. */
function mockApi({ artist = profile, list = songs } = {}) {
    api.get.mockImplementation(async (url, config) => {
        if (url === `/catalog/artists/${ID}`) {
            if (artist instanceof Error) throw artist;
            return { data: artist };
        }
        const sorted = config.params.sort === "longest"
            ? [...list].sort((a, b) => b.duration - a.duration)
            : [...list].sort((a, b) => a.title.localeCompare(b.title));
        return { data: sorted, headers: { "x-total-count": String(list.length) } };
    });
}

function renderArtist() {
    return render(<MemoryRouter initialEntries={[`/artists/${ID}`]}><Routes>
        <Route path="/artists/:artistId" element={<Artist />} />
    </Routes></MemoryRouter>);
}

describe("Página del artista", () => {
    beforeEach(() => vi.resetAllMocks());

    it("muestra el perfil y solo sus canciones, ordenables", async () => {
        mockApi();
        renderArtist();
        expect(await screen.findByRole("heading", { level: 1, name: "Ana y los Teros" })).toBeTruthy();
        expect(screen.getByText(/@ana · 2 canciones/)).toBeTruthy();
        expect(api.get).toHaveBeenCalledWith("/catalog/songs", { params: { artist_id: ID, sort: "title", limit: 50, offset: 0 } });
        expect(titles()).toEqual(["Alba", "Zamba"]);

        fireEvent.change(screen.getByRole("combobox", { name: "Ordenar" }), { target: { value: "longest" } });
        await waitFor(() => expect(titles()).toEqual(["Zamba", "Alba"]));
        // Ya estás en la página del artista: las tarjetas no repiten su nombre.
        expect(screen.queryByRole("link", { name: "Ana" })).toBeNull();
    });

    it("si el perfil no llegó al catálogo usa el nombre de las canciones", async () => {
        mockApi({ artist: { ...profile, username: null, display_name: null } });
        renderArtist();
        expect(await screen.findByRole("heading", { level: 1, name: "Ana" })).toBeTruthy();
    });

    it("sin canciones publicadas lo avisa", async () => {
        mockApi({ list: [] });
        renderArtist();
        expect(await screen.findByText("Todavía no tiene canciones publicadas.")).toBeTruthy();
    });

    it("artista inexistente: mensaje y vuelta al catálogo", async () => {
        mockApi({ artist: Object.assign(new Error("404"), { response: { status: 404 } }) });
        renderArtist();
        expect(await screen.findByText("No encontramos a este artista.")).toBeTruthy();
        expect(screen.getByRole("link", { name: "Ir al catálogo" }).getAttribute("href")).toBe("/catalog");
    });

    it("si falla la red deja reintentar", async () => {
        mockApi({ artist: new Error("offline") });
        renderArtist();
        await screen.findByRole("alert");
        mockApi();
        fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        expect(await screen.findByRole("heading", { level: 1, name: "Ana y los Teros" })).toBeTruthy();
    });
});
