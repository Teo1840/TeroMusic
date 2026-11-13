import { expect, it } from "vitest";
import { SORTS, songCount } from "./catalog";

it("songCount", () => {
    expect(songCount(1)).toBe("1 canción");
    expect(songCount(0)).toBe("0 canciones");
    expect(songCount(3)).toBe("3 canciones");
});

it("los órdenes son los que acepta GET /songs?sort=", () => {
    expect(SORTS.map((s) => s.id)).toEqual(["title", "artist", "newest", "longest", "shortest"]);
});
