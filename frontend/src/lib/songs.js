import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client";

/** Tamaño de página del catálogo (el server admite hasta 200). */
export const PAGE_SIZE = 50;

/**
 * GET /catalog/songs con filtros del server (q, sort, artist_id, limit, offset).
 * Devuelve { songs, total }: el total viene en el header X-Total-Count.
 * Parámetros vacíos no se mandan.
 */
export async function fetchSongs(params = {}) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    const { data, headers } = await api.get("/catalog/songs", { params: clean });
    const total = Number.parseInt(headers?.["x-total-count"] ?? "", 10);
    return { songs: data, total: Number.isFinite(total) ? total : data.length };
}

/** El valor, pero recién cuando deja de cambiar por `ms` (para no pedir en cada tecla). */
export function useDebounced(value, ms = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), ms);
        return () => clearTimeout(timer);
    }, [value, ms]);
    return debounced;
}

/**
 * Canciones publicadas de a páginas, con "Cargar más".
 * Al cambiar los filtros vuelve a la primera página. Ignora respuestas viejas
 * (si se escribe rápido, una búsqueda anterior puede llegar después).
 */
export function useSongPages(filters) {
    const key = JSON.stringify(filters);
    const [songs, setSongs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const request = useRef(0);

    const load = useCallback(async (offset) => {
        const id = ++request.current;
        if (offset === 0) setLoading(true);
        else setLoadingMore(true);
        try {
            const page = await fetchSongs({ ...JSON.parse(key), limit: PAGE_SIZE, offset });
            if (id !== request.current) return;
            setSongs((prev) => (offset === 0 ? page.songs : [...prev, ...page.songs]));
            setTotal(page.total);
            setError(null);
        } catch (err) {
            if (id === request.current) setError(err);
        } finally {
            if (id === request.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [key]);

    useEffect(() => {
        load(0);
    }, [load]);

    return {
        songs,
        total,
        loading,
        loadingMore,
        error,
        hasMore: songs.length < total,
        loadMore: () => load(songs.length),
        reload: () => load(0)
    };
}
