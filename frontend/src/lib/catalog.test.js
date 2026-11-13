import { describe, expect, it } from "vitest";
import { artistsOf, songCount, sortSongs } from "./catalog";

const songs = [
    { id: "1", title: "Zamba", artist_id: "b", artist_name: "Bruno", duration: 200 },
    { id: "2", title: "álamo", artist_id: "a", artist_name: "Ana", duration: 90 },
    { id: "3", title: "Canción 10", artist_id: "a", artist_name: "Ana", duration: null },
    { id: "4", title: "Canción 2", artist_id: null, artist_name: null, duration: 300 }
];
const ids = (list) => list.map((s) => s.id);

describe("sortSongs", () => {
    it("por título ignora tildes/mayúsculas y ordena números como números", () => {
        expect(ids(sortSongs(songs, "title"))).toEqual(["2", "4", "3", "1"]);
    });

    it("por artista, y dentro del mismo artista por título", () => {
        expect(ids(sortSongs(songs, "artist"))).toEqual(["2", "3", "4", "1"]);
    });

    it("por duración deja al final las que no tienen", () => {
        expect(ids(sortSongs(songs, "longest"))).toEqual(["4", "1", "2", "3"]);
        expect(ids(sortSongs(songs, "shortest"))).toEqual(["2", "1", "4", "3"]);
    });

    it("no modifica la lista original", () => {
        const copy = [...songs];
        sortSongs(songs, "artist");
        expect(songs).toEqual(copy);
    });
});

describe("artistsOf", () => {
    it("agrupa por artista con su cantidad", () => {
        expect(artistsOf(songs)).toEqual([
            { id: "a", name: "Ana", count: 2 },
            { id: "", name: "Artista desconocido", count: 1 },
            { id: "b", name: "Bruno", count: 1 }
        ]);
    });
});

it("songCount", () => {
    expect(songCount(1)).toBe("1 canción");
    expect(songCount(0)).toBe("0 canciones");
});
