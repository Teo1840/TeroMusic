import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import api from "../api/client";
import { PlayerProvider } from "../lib/player";
import AudioPlayer from "./AudioPlayer";
import NowPlayingBar from "./NowPlayingBar";

vi.mock("../api/client", () => ({ default: { get: vi.fn() } }));
vi.mock("../lib/auth", () => ({ hasValidToken: () => true }));
vi.mock("../lib/roomSession", () => ({ useRoomSession: () => null }));
vi.mock("../lib/audio", () => ({
    PLAY_EVENT: "teromusic:play",
    useSignedStreamUrl: (id) => ({ src: id ? `/audio/${id}` : null, onError: vi.fn(), onLoadedData: vi.fn() }),
    usePlayTracking: () => ({ onPlay: vi.fn(), onTimeUpdate: vi.fn(), onSeeked: vi.fn(), onEnded: vi.fn() })
}));

const song = { id: "s1", title: "Zamba", artist_name: "Ana", duration: 120 };

function renderApp() {
    return render(
        <MemoryRouter initialEntries={["/catalog"]}>
            <PlayerProvider>
                <Routes>
                    <Route path="/catalog" element={<><AudioPlayer song={song} /><Link to="/otra">Ir</Link></>} />
                    <Route path="/otra" element={<p>Otra página</p>} />
                </Routes>
                <NowPlayingBar />
            </PlayerProvider>
        </MemoryRouter>
    );
}

const queue = [song, { id: "s2", title: "Chacarera", artist_name: "Beto" }, { id: "s3", title: "Huayno", artist_name: "Caro" }];

function renderList() {
    return render(
        <MemoryRouter initialEntries={["/catalog"]}>
            <PlayerProvider>
                {queue.map((s) => <AudioPlayer key={s.id} song={s} queue={queue} />)}
                <NowPlayingBar />
            </PlayerProvider>
        </MemoryRouter>
    );
}

beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    api.get.mockResolvedValue({ data: {} });
    // jsdom no reproduce: se simula el estado de pausa del <audio>.
    let paused = true;
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
        paused = false;
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function () {
        if (!paused) this.dispatchEvent(new Event("pause"));
        paused = true;
    });
});

it("al reproducir desde el catálogo abre la barra de abajo con la canción", async () => {
    renderApp();
    expect(screen.queryByRole("region", { name: "Sonando ahora" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));

    const bar = await screen.findByRole("region", { name: "Sonando ahora" });
    expect(within(bar).getByText("Zamba")).toBeTruthy();
    expect(within(bar).getByText("Ana")).toBeTruthy();
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(within(bar).getByRole("button", { name: "Pausar" })).toBeTruthy();
});

it("sigue sonando al salir del catálogo y se puede pausar o cerrar desde la barra", async () => {
    const { container } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    HTMLMediaElement.prototype.pause.mockClear();

    fireEvent.click(screen.getByRole("link", { name: "Ir" }));
    expect(screen.getByText("Otra página")).toBeTruthy();
    expect(container.querySelector("audio").getAttribute("src")).toBe("/audio/s1");
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();

    const bar = screen.getByRole("region", { name: "Sonando ahora" });
    fireEvent.click(within(bar).getByRole("button", { name: "Pausar" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(within(bar).getByRole("button", { name: "Reproducir" })).toBeTruthy();

    fireEvent.click(within(bar).getByRole("button", { name: "Cerrar reproductor" }));
    expect(screen.queryByRole("region", { name: "Sonando ahora" })).toBeNull();
    expect(container.querySelector("audio").getAttribute("src")).toBeNull();
});

it("si suena otro reproductor (la sala), el del catálogo se pausa", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Reproducir" }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    HTMLMediaElement.prototype.pause.mockClear();

    window.dispatchEvent(new CustomEvent("teromusic:play", { detail: "room" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

it("con aleatorio, al terminar sigue otra canción de la lista sin repetir hasta escucharlas todas", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { container } = renderList();
    const audio = () => container.querySelector("audio");
    fireEvent.click(screen.getAllByRole("button", { name: "Reproducir" })[0]);

    const bar = await screen.findByRole("region", { name: "Sonando ahora" });
    expect(within(bar).queryByRole("button", { name: "Siguiente" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Aleatorio" }));
    expect(within(bar).getByRole("button", { name: "Aleatorio" }).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("player_shuffle")).toBe("1");

    fireEvent(audio(), new Event("ended"));
    await waitFor(() => expect(audio().getAttribute("src")).toBe("/audio/s2"));
    expect(within(bar).getByText("Chacarera")).toBeTruthy();

    fireEvent.click(within(bar).getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(audio().getAttribute("src")).toBe("/audio/s3"));

    // Ya sonaron las tres: empieza otra vuelta.
    fireEvent(audio(), new Event("ended"));
    await waitFor(() => expect(audio().getAttribute("src")).toBe("/audio/s1"));
});

it("sin aleatorio, al terminar la canción no pasa a otra", async () => {
    const { container } = renderList();
    fireEvent.click(screen.getAllByRole("button", { name: "Reproducir" })[0]);
    await screen.findByRole("region", { name: "Sonando ahora" });

    fireEvent(container.querySelector("audio"), new Event("ended"));
    expect(container.querySelector("audio").getAttribute("src")).toBe("/audio/s1");
    expect(screen.getByRole("region", { name: "Sonando ahora" })).toBeTruthy();
});
