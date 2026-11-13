import { describe, expect, it } from "vitest";
import { formatDate, formatMonthYear, initials } from "./format";

describe("initials", () => {
    it.each([
        ["Ana María López", "AL"],
        ["teo", "T"],
        ["  ana   lópez  ", "AL"],
        ["Ñandú Ávila", "ÑÁ"],
        ["", "?"],
        ["   ", "?"],
        [null, "?"],
        [undefined, "?"]
    ])("%j → %s", (name, expected) => {
        expect(initials(name)).toBe(expected);
    });

    it("no parte emojis por la mitad", () => {
        expect(initials("😀 Tero")).toBe("😀T");
    });
});

describe("fechas", () => {
    it("formatea mes y año en castellano", () => {
        expect(formatMonthYear("2026-03-15T12:00:00Z")).toMatch(/marzo de 2026/i);
    });

    it("formatea la fecha completa en castellano", () => {
        expect(formatDate("2026-11-13T12:00:00Z")).toMatch(/13 de noviembre de 2026/i);
    });

    it.each([undefined, null, "", "no-es-fecha"])("devuelve \"\" con %j", (value) => {
        expect(formatMonthYear(value)).toBe("");
        expect(formatDate(value)).toBe("");
    });
});
