import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import api from "../api/client";
import Catalog from "../pages/Catalog";
import AddToPlaylist from "./AddToPlaylist";

vi.mock("../api/client", () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./AudioPlayer", () => ({ default: () => null }));
const song = { id: "song-a", title: "Mi tema" };
const playlists = [{ id: "p1", name: "Favoritas" }, { id: "p2", name: "Viaje" }];

beforeEach(() => {
    vi.resetAllMocks();
    api.get.mockResolvedValue({ data: playlists });
    api.post.mockResolvedValue({});
});

function renderPicker() {
    render(<MemoryRouter><AddToPlaylist song={song} /></MemoryRouter>);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar a playlist" }));
}

it("desde el Catálogo agrega con un solo clic en la playlist", async () => {
    api.get.mockImplementation(async (url) => ({ data: url === "/catalog/songs" ? [song] : playlists }));
    render(<MemoryRouter><Catalog /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a playlist" }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a Viaje" }));
    expect((await screen.findByRole("status")).textContent).toContain('a "Viaje"');
    expect(api.post).toHaveBeenCalledWith("/catalog/playlists/p2/songs", { song_id: "song-a" });
    // Queda marcada: no se puede volver a agregar sin querer.
    expect(screen.getByRole("button", { name: "Viaje (ya está)" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Agregar a Favoritas" }).disabled).toBe(false);
});

it("muestra duplicados sin presentarlos como un agregado nuevo", async () => {
    api.post.mockRejectedValue({ response: { status: 409 } });
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a Favoritas" }));
    expect((await screen.findByRole("status")).textContent).toContain('ya está en "Favoritas"');
    expect(screen.getByRole("button", { name: "Favoritas (ya está)" })).toBeTruthy();
});

it("sin playlists, crea una ahí mismo con la canción adentro", async () => {
    api.get.mockResolvedValue({ data: [] });
    api.post.mockImplementation(async (url) => (url === "/catalog/playlists"
        ? { data: { id: "nueva", name: "Para correr", song_count: 0 } }
        : {}));
    renderPicker();
    const input = await screen.findByRole("textbox", { name: "Nombre de la nueva playlist" });
    expect(screen.getByRole("button", { name: "Crear y agregar" }).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "  Para correr " } });
    fireEvent.click(screen.getByRole("button", { name: "Crear y agregar" }));

    expect((await screen.findByRole("status")).textContent).toContain('Se creó "Para correr" con "Mi tema"');
    expect(api.post).toHaveBeenNthCalledWith(1, "/catalog/playlists", { name: "Para correr" });
    expect(api.post).toHaveBeenNthCalledWith(2, "/catalog/playlists/nueva/songs", { song_id: "song-a" });
    expect(screen.getByRole("button", { name: "Para correr (ya está)" })).toBeTruthy();
    expect(input.value).toBe("");
});

it("si no se puede crear la playlist lo dice y no agrega nada", async () => {
    api.post.mockRejectedValueOnce({ response: { status: 422, data: { detail: [{ msg: "Nombre inválido" }] } } });
    renderPicker();
    fireEvent.change(await screen.findByRole("textbox", { name: "Nombre de la nueva playlist" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear y agregar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nombre inválido");
    expect(api.post).toHaveBeenCalledTimes(1);
});

it("permite volver a cargar tras un error de red", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"));
    renderPicker();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar playlists" }));
    await screen.findByRole("button", { name: "Agregar a Favoritas" });
    expect(api.get).toHaveBeenCalledTimes(2);
});

it("muestra los errores del agregado y permite reintentar", async () => {
    api.post.mockRejectedValueOnce({ response: { status: 403, data: { detail: "La playlist es de otro usuario" } } });
    renderPicker();
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a Favoritas" }));
    expect((await screen.findByRole("alert")).textContent).toContain("La playlist es de otro usuario");
    fireEvent.click(screen.getByRole("button", { name: "Agregar a Favoritas" }));
    await screen.findByRole("status");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(2);
});
