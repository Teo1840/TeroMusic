import { describe, expect, it } from "vitest";
import { isOver, positionAt } from "./room";

const base = { song_id: "s1", duration_sec: 10, position_ms: 0, playing: true, updated_at_ms: 1000 };

describe("positionAt", () => {
    it("avanza con el reloj si está sonando y no pasa del final", () => {
        expect(positionAt(base, 4000)).toBe(3000);
        expect(positionAt(base, 999999)).toBe(10000);
    });

    it("en pausa queda quieta", () => {
        expect(positionAt({ ...base, playing: false, position_ms: 2500 }, 999999)).toBe(2500);
    });
});

describe("isOver", () => {
    it("es false mientras suena y true al llegar al final", () => {
        expect(isOver(base, 1000 + 9999)).toBe(false);
        expect(isOver(base, 1000 + 10000)).toBe(true);
    });

    it("una canción en pausa al final cuenta como terminada", () => {
        expect(isOver({ ...base, playing: false, position_ms: 10000 }, 0)).toBe(true);
    });

    it.each([
        ["sin playback", null],
        ["sin canción", { ...base, song_id: null }],
        ["sin duración conocida", { ...base, duration_sec: 0 }],
        ["duración inválida", { ...base, duration_sec: undefined }]
    ])("es false %s", (_, playback) => {
        expect(isOver(playback, 1e12)).toBe(false);
    });
});
