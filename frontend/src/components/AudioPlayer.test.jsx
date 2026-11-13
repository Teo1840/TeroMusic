import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AudioPlayer from "./AudioPlayer";
import api from "../api/client";

vi.mock("../api/client", () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }) } }));
vi.mock("../lib/audio", () => ({
    PLAY_EVENT: "teromusic:play",
    useSignedStreamUrl: (id) => ({ src: `/audio/${id}`, onError: vi.fn(), onLoadedData: vi.fn() }),
    usePlayTracking: () => ({ onPlay: vi.fn(), onTimeUpdate: vi.fn(), onSeeked: vi.fn(), onEnded: vi.fn() })
}));

beforeEach(() => {
    api.get.mockResolvedValue({ data: {} });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

it("inicia automáticamente la cola aunque el reproductor esté fuera de pantalla", async () => {
    const observe = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
        observe = observe;
        disconnect = vi.fn();
    });
    const onEnded = vi.fn();
    const { container } = render(<AudioPlayer songId="a" autoPlay onEnded={onEnded} />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    fireEvent.ended(container.querySelector("audio"));
    expect(onEnded).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
});

it("avisa si el navegador bloquea la reproducción automática", async () => {
    HTMLMediaElement.prototype.play.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    render(<AudioPlayer songId="a" autoPlay />);
    expect((await screen.findByRole("status")).textContent).toContain("Tocá Reproducir");
    expect(screen.getByRole("button", { name: "Reproducir" })).toBeTruthy();
});

it("vuelve a iniciar el audio cuando cambia la canción de la cola", async () => {
    const { container, rerender } = render(<AudioPlayer songId="a" autoPlay />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    rerender(<AudioPlayer songId="b" autoPlay />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
    expect(container.querySelector("audio").getAttribute("src")).toBe("/audio/b");
});
