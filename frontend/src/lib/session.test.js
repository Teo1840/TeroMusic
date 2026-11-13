import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "../api/client";
import { getToken, saveToken } from "./auth";
import { REFRESH_BEFORE_MS, refreshIfNeeded } from "./session";

vi.mock("../api/client", () => ({ default: { post: vi.fn() } }));

/** JWT sin firma válida (el navegador no la verifica): solo importa "exp". */
function token(msLeft) {
    const payload = btoa(JSON.stringify({ sub: "u1", exp: Math.floor((Date.now() + msLeft) / 1000) }));
    return `h.${payload}.s`;
}

beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
});

describe("refreshIfNeeded", () => {
    it("no pide nada si al token le queda tiempo de sobra", async () => {
        saveToken(token(REFRESH_BEFORE_MS + 60000));
        expect(await refreshIfNeeded()).toBe(false);
        expect(api.post).not.toHaveBeenCalled();
    });

    it("cuando le queda poco lo cambia por uno nuevo", async () => {
        saveToken(token(60000));
        api.post.mockResolvedValue({ data: { access_token: "nuevo" } });
        expect(await refreshIfNeeded()).toBe(true);
        expect(api.post).toHaveBeenCalledWith("/auth/refresh");
        expect(getToken()).toBe("nuevo");
    });

    it("dos llamadas juntas hacen un solo pedido", async () => {
        saveToken(token(60000));
        api.post.mockResolvedValue({ data: { access_token: "nuevo" } });
        await Promise.all([refreshIfNeeded(), refreshIfNeeded()]);
        expect(api.post).toHaveBeenCalledTimes(1);
    });

    it("sin token o vencido no intenta renovar", async () => {
        expect(await refreshIfNeeded()).toBe(false);
        saveToken(token(-1000));
        expect(await refreshIfNeeded()).toBe(false);
        expect(api.post).not.toHaveBeenCalled();
    });

    it("si el server rechaza, deja el token como estaba", async () => {
        const viejo = token(60000);
        saveToken(viejo);
        api.post.mockRejectedValue({ response: { status: 401 } });
        expect(await refreshIfNeeded()).toBe(false);
        expect(getToken()).toBe(viejo);
    });
});
