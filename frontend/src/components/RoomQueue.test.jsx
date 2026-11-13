import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RoomQueue from "./RoomQueue";

const ARTIST = "5a1e2f30-8c4b-4f9d-a7e6-1b2c3d4e5f60";
const me = { user_id: "u1", name: "lu" };
const item = (over) => ({ item_id: over.song_id, duration_sec: 100, added_by: { user_id: "u2", name: "ana" }, ...over });

function renderQueue(props) {
    return render(<MemoryRouter>
        <RoomQueue queue={[]} suggestions={[]} canControl me={me} send={vi.fn()} {...props} />
    </MemoryRouter>);
}

it("cada canción de la cola muestra su artista con enlace a su página", () => {
    renderQueue({ queue: [item({ song_id: "s1", title: "Uno", artist_id: ARTIST, artist_name: "Los Teros" })] });
    const link = screen.getByRole("link", { name: "Los Teros" });
    expect(link.getAttribute("href")).toBe(`/artists/${ARTIST}`);
    expect(screen.getByText(/agregada por ana/)).toBeTruthy();
});

it("las sugerencias también muestran el artista", () => {
    renderQueue({
        canControl: false,
        suggestions: [item({ song_id: "s2", title: "Dos", artist_id: ARTIST, artist_name: "Los Teros", added_by: me })]
    });
    expect(screen.getByRole("link", { name: "Los Teros" })).toBeTruthy();
    expect(screen.getByText(/sugerida por vos/)).toBeTruthy();
});

it("elementos sin artista (agregados antes del cambio) dicen artista desconocido", () => {
    renderQueue({ queue: [item({ song_id: "s3", title: "Tres" })] });
    expect(screen.getByText("Artista desconocido")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
});
