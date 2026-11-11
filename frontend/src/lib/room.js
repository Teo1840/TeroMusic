import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Conexión en vivo con una sala (rooms_service).
 *
 * - Se autentica mandando el JWT en el primer mensaje.
 * - Sincroniza el reloj con el servidor (ping/pong): `serverNow()` da la hora del servidor.
 * - Si se corta, se reconecta sola (salvo que la sala se haya cerrado o no exista).
 */

// Códigos de cierre de rooms_service (ver services/rooms_service/README.md).
const FINAL_CLOSES = {
    4001: "No se pudo verificar tu sesión. Volvé a iniciar sesión.",
    4003: "La sala está llena.",
    4004: "La sala no existe.",
    4010: "El anfitrión cerró la sala."
};

/** Igual que playback.positionAt del servidor: posición en ms en el instante `now`. */
export function positionAt(playback, now) {
    let position = playback.position_ms;
    if (playback.playing) position += Math.max(0, now - playback.updated_at_ms);
    if (playback.duration_sec > 0) position = Math.min(position, playback.duration_sec * 1000);
    return position;
}

export function useRoom(roomId) {

    const [state, setState] = useState(null);      // { room, playback, queue, suggestions, listeners }
    const [me, setMe] = useState(null);            // { user_id, name }
    const [status, setStatus] = useState("connecting");
    const [error, setError] = useState("");        // error de un comando (se borra solo)
    const [fatal, setFatal] = useState("");        // la sala ya no se puede usar

    const wsRef = useRef(null);
    // Diferencia servidor - navegador en ms. Se queda con la medición de menor ida y vuelta.
    const clock = useRef({ offset: 0, bestRtt: Infinity });

    const serverNow = useCallback(() => Date.now() + clock.current.offset, []);

    const send = useCallback((message) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    }, []);

    useEffect(() => {
        let stopped = false;
        let retryMs = 1000;
        let retryTimer = null;
        let pingTimer = null;

        const ping = () => send({ type: "ping", t: Date.now() });

        const connect = () => {
            const protocol = window.location.protocol === "https:" ? "wss" : "ws";
            const ws = new WebSocket(`${protocol}://${window.location.host}/api/v1/ws/rooms/${roomId}`);
            wsRef.current = ws;
            setStatus("connecting");

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: "auth", token: localStorage.getItem("access_token") }));
            };

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);

                if (message.type === "welcome") {
                    setMe(message.user);
                    setStatus("connected");
                    retryMs = 1000;
                    // Varias mediciones al entrar y después una cada 10 s.
                    clock.current = { offset: message.server_time - Date.now(), bestRtt: Infinity };
                    [0, 300, 600].forEach((ms) => setTimeout(ping, ms));
                    clearInterval(pingTimer);
                    pingTimer = setInterval(ping, 10000);
                } else if (message.type === "pong") {
                    const now = Date.now();
                    const rtt = now - message.t;
                    // El servidor respondió a mitad de camino: su hora + rtt/2 ≈ ahora.
                    if (rtt <= clock.current.bestRtt * 1.5) {
                        clock.current = {
                            offset: message.server_time + rtt / 2 - now,
                            bestRtt: Math.min(rtt, clock.current.bestRtt)
                        };
                    }
                } else if (message.type === "state") {
                    setState({
                        room: message.room,
                        playback: message.playback,
                        queue: message.queue ?? [],
                        suggestions: message.suggestions ?? [],
                        listeners: message.listeners
                    });
                } else if (message.type === "error") {
                    setError(message.detail);
                    setTimeout(() => setError(""), 4000);
                }
            };

            ws.onclose = (event) => {
                clearInterval(pingTimer);
                if (stopped) return;
                if (FINAL_CLOSES[event.code]) {
                    setFatal(FINAL_CLOSES[event.code]);
                    setStatus("closed");
                    return;
                }
                setStatus("reconnecting");
                retryTimer = setTimeout(connect, retryMs);
                retryMs = Math.min(retryMs * 2, 10000);
            };
        };

        connect();

        return () => {
            stopped = true;
            clearTimeout(retryTimer);
            clearInterval(pingTimer);
            wsRef.current?.close();
        };
    }, [roomId, send]);

    return { state, me, status, error, fatal, send, serverNow };
}
