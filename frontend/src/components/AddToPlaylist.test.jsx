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

it("agrega desde el Catálogo a la playlist elegida", async () => {
    api.get.mockImplementation(async (url) => ({ data: url === "/catalog/songs" ? [song] : playlists }));
    render(<MemoryRouter><Catalog /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar a playlist" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar", exact: true }));
    expect((await screen.findByRole("status")).textContent).toContain('a "Viaje"');
    expect(api.post).toHaveBeenCalledWith("/catalog/playlists/p2/songs", { song_id: "song-a" });
});

it("muestra duplicados sin presentarlos como un agregado nuevo", async () => {
    api.post.mockRejectedValue({ response: { status: 409 } });
    renderPicker();
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Agregar", exact: true }));
    expect((await screen.findByRole("status")).textContent).toContain('ya está en "Favoritas"');
});

it("ofrece crear una playlist si no hay ninguna", async () => {
    api.get.mockResolvedValue({ data: [] });
    renderPicker();
    expect((await screen.findByRole("link", { name: "Crear una playlist" })).getAttribute("href")).toBe("/playlists");
    expect(screen.queryByRole("combobox")).toBeNull();
});

it("permite volver a cargar tras un error de red", async () => {
    api.get.mockRejectedValueOnce(new Error("offline"));
    renderPicker();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar playlists" }));
    await screen.findByRole("combobox");
    expect(api.get).toHaveBeenCalledTimes(2);
});

it("muestra los errores del agregado y permite reintentar", async () => {
    api.post.mockRejectedValueOnce({ response: { status: 403, data: { detail: "La playlist es de otro usuario" } } });
    renderPicker();
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Agregar", exact: true }));
    expect((await screen.findByRole("alert")).textContent).toContain("La playlist es de otro usuario");
    fireEvent.click(screen.getByRole("button", { name: "Volver a cargar playlists" }));
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Agregar", exact: true }));
    await screen.findByRole("status");
    expect(api.post).toHaveBeenCalledTimes(2);
});
