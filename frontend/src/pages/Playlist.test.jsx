import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../api/client";
import Playlist from "./Playlist";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() } }));
vi.mock("../components/AudioPlayer", () => ({
    default: ({ songId, autoPlay, onEnded }) => (
        <div data-testid="audio" data-song={songId} data-autoplay={String(autoPlay)}>
            <button onClick={onEnded}>Simular fin de audio</button>
        </div>
    )
}));

const songs = [
    { id: "a", title: "Primera", status: "PUBLICADO" },
    { id: "b", title: "No lista", status: "FALLIDO" },
    { id: "c", title: "Última", status: "PUBLICADO" }
];

function openPlaylist(items = songs) {
    api.get.mockImplementation(async (url) => ({ data: url === "/catalog/songs" ? [] : { id: "p", name: "Favoritas", songs: items } }));
    return render(<MemoryRouter initialEntries={["/playlists/p"]}><Routes>
        <Route path="/playlists/:playlistId" element={<Playlist />} />
    </Routes></MemoryRouter>);
}

beforeEach(() => {
    vi.resetAllMocks();
    api.delete.mockResolvedValue({});
    api.put.mockResolvedValue({});
});

afterEach(() => vi.restoreAllMocks());

describe("cola de playlist", () => {
    it("reproduce en orden, omite canciones no disponibles y termina sin repetir", async () => {
        openPlaylist();
        fireEvent.click(await screen.findByRole("button", { name: "Reproducir playlist" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("a");
        expect(screen.getByTestId("audio").dataset.autoplay).toBe("true");
        expect(screen.getAllByTestId("audio")).toHaveLength(1);
        fireEvent.click(screen.getByText("Simular fin de audio"));
        expect(screen.getByTestId("audio").dataset.song).toBe("c");
        fireEvent.click(screen.getByText("Simular fin de audio"));
        expect(screen.queryByTestId("audio")).toBeNull();
        expect(screen.getByRole("status").textContent).toBe("Terminó la playlist.");
    });

    it("permite comenzar desde una canción y navegar hacia atrás o detener", async () => {
        openPlaylist();
        fireEvent.click(await screen.findByRole("button", { name: "Reproducir desde Última" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("c");
        expect(screen.getByRole("button", { name: "Siguiente" }).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("a");
        fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("c");
        fireEvent.click(screen.getByRole("button", { name: "Detener" }));
        expect(screen.queryByTestId("audio")).toBeNull();
    });

    it.each([{ items: [] }, { items: [songs[1]] }])("deshabilita reproducir si no hay canciones disponibles: $items", async ({ items }) => {
        openPlaylist(items);
        expect((await screen.findByRole("button", { name: "Reproducir playlist" })).disabled).toBe(true);
    });

    it("en aleatorio mezcla la cola sin mover la actual y al apagarlo vuelve al orden normal", async () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        openPlaylist([songs[0], songs[2], { id: "d", title: "Tercera", status: "PUBLICADO" }]);
        fireEvent.click(await screen.findByRole("button", { name: "Reproducir playlist" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("a");

        const shuffleButton = screen.getByRole("button", { name: "Aleatorio" });
        fireEvent.click(shuffleButton);
        expect(shuffleButton.getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByTestId("audio").dataset.song).toBe("a");
        expect(screen.getByText(/Canción 1 de 3/)).toBeTruthy();

        // Con Math.random en 0 la mezcla de [c, d] queda [d, c].
        fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("d");
        fireEvent.click(screen.getByText("Simular fin de audio"));
        expect(screen.getByTestId("audio").dataset.song).toBe("c");
        expect(screen.getByText(/Canción 3 de 3/)).toBeTruthy();

        fireEvent.click(shuffleButton);
        expect(shuffleButton.getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByText("Canción 2 de 3")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
        expect(screen.getByTestId("audio").dataset.song).toBe("d");
    });

    it("sigue el orden actualizado sin reiniciar la canción actual", async () => {
        openPlaylist([songs[0], songs[2]]);
        fireEvent.click(await screen.findByRole("button", { name: "Reproducir playlist" }));
        const row = screen.getByRole("button", { name: "Reproducir desde Última" }).closest("li");
        fireEvent.click(within(row).getByRole("button", { name: "Subir" }));
        await waitFor(() => expect(api.put).toHaveBeenCalledWith("/catalog/playlists/p/songs", { song_ids: ["c", "a"] }));
        expect(screen.getByTestId("audio").dataset.song).toBe("a");
        fireEvent.click(screen.getByText("Simular fin de audio"));
        expect(screen.queryByTestId("audio")).toBeNull();
    });

    it("detiene el audio al sacar la canción actual", async () => {
        openPlaylist();
        fireEvent.click(await screen.findByRole("button", { name: "Reproducir playlist" }));
        fireEvent.click(screen.getByRole("button", { name: 'Sacar "Primera" de la playlist' }));
        await waitFor(() => expect(screen.queryByTestId("audio")).toBeNull());
        expect(api.delete).toHaveBeenCalledWith("/catalog/playlists/p/songs/a");
    });
});

describe("compartir", () => {
    function open(data) {
        api.get.mockImplementation(async (url) => ({ data: url === "/catalog/songs" ? [] : { id: "p", name: "Disco", songs, ...data } }));
        render(<MemoryRouter initialEntries={["/playlists/p"]}><Routes>
            <Route path="/playlists/:playlistId" element={<Playlist />} />
        </Routes></MemoryRouter>);
    }

    it("el dueño la comparte y ve el link", async () => {
        api.patch = vi.fn().mockResolvedValue({ data: { id: "p", name: "Disco", is_public: true } });
        open({ is_owner: true, is_public: false });
        fireEvent.click(await screen.findByRole("button", { name: "Compartir" }));
        expect(api.patch).toHaveBeenCalledWith("/catalog/playlists/p", { is_public: true });
        expect((await screen.findByRole("textbox", { name: "Link de la playlist" })).value).toMatch(/\/playlists\/p$/);
        expect(screen.getByRole("button", { name: "Dejar de compartir" })).toBeTruthy();
    });

    it("quien no es dueño solo la ve y la escucha", async () => {
        open({ is_owner: false, is_public: true, owner_name: "Ana" });
        expect(await screen.findByText("Ana")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reproducir playlist" }).disabled).toBe(false);
        expect(screen.queryByRole("button", { name: "Cambiar nombre" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Compartir" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Subir" })).toBeNull();
        expect(screen.queryByRole("button", { name: /^Sacar/ })).toBeNull();
        expect(screen.queryByText("Agregar canción:")).toBeNull();
    });

    it("una privada de otro avisa que es privada", async () => {
        api.get.mockImplementation(async (url) => {
            if (url === "/catalog/songs") return { data: [] };
            throw { response: { status: 403 } };
        });
        render(<MemoryRouter initialEntries={["/playlists/p"]}><Routes>
            <Route path="/playlists/:playlistId" element={<Playlist />} />
        </Routes></MemoryRouter>);
        expect((await screen.findByRole("alert")).textContent).toContain("privada");
    });
});
