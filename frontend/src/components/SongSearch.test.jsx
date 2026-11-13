import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import api from "../api/client";
import SongSearch from "./SongSearch";

vi.mock("../api/client", () => ({ default: { get: vi.fn() } }));

const songs = [
    { id: "1", title: "Alba", artist_name: "Ana" },
    { id: "2", title: "Brisa", artist_name: "Ana" }
];

beforeEach(() => {
    vi.resetAllMocks();
    api.get.mockResolvedValue({ data: songs, headers: { "x-total-count": "2" } });
});

it("busca en el server lo escrito (una sola vez al dejar de tipear) y elige", async () => {
    const onPick = vi.fn();
    render(<SongSearch label="Agregar:" onPick={onPick} />);
    expect(api.get).not.toHaveBeenCalled();

    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.change(box, { target: { value: "ana" } });
    fireEvent.click(await screen.findByRole("button", { name: /Brisa/ }));

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("/catalog/songs", { params: { q: "ana", limit: 10 } });
    expect(onPick).toHaveBeenCalledWith(songs[1]);
    expect(box.value).toBe("");
});

it("no ofrece las excluidas (p. ej. las que ya están en la playlist)", async () => {
    render(<SongSearch label="Agregar:" onPick={vi.fn()} exclude={new Set(["1"])} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ana" } });
    await screen.findByRole("button", { name: /Brisa/ });
    expect(screen.queryByRole("button", { name: /Alba/ })).toBeNull();
    expect(api.get.mock.calls[0][1].params.limit).toBe(11);
});

it("avisa si no hay resultados o si falla", async () => {
    api.get.mockResolvedValueOnce({ data: [], headers: {} }).mockRejectedValueOnce(new Error("caído"));
    render(<SongSearch label="Agregar:" onPick={vi.fn()} />);
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(await screen.findByText("No hay canciones con ese nombre.")).toBeTruthy();
    fireEvent.change(box, { target: { value: "yyy" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No se pudo buscar"));
});
