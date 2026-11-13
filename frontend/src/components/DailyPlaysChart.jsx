import { useState } from "react";

const plural = (n) => `${n} ${n === 1 ? "reproducción" : "reproducciones"}`;

/** "2026-11-13" → fecha local sin correrse de día por la zona horaria. */
function parseDay(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
}

const shortDay = (iso) => parseDay(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
const longDay = (iso) => parseDay(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });

/**
 * Reproducciones por día: una sola serie, en barras (una por día, la última es hoy).
 * Pasando el mouse por una columna se ve el día y la cantidad; debajo hay una tabla
 * con los mismos datos para lectores de pantalla o para copiar.
 *
 * days: [{ date: "YYYY-MM-DD", plays }]
 */
export default function DailyPlaysChart({ days, title }) {
    const [hover, setHover] = useState(null);
    const max = Math.max(1, ...days.map((d) => d.plays));
    const active = hover === null ? null : days[hover];
    const labelEvery = Math.max(1, Math.ceil(days.length / 6));

    return (
        <figure className="m-0">
            <div className="relative" onMouseLeave={() => setHover(null)}>
                {/* Escala: solo el máximo, con una línea de referencia tenue. */}
                <div className="flex items-start gap-2 text-xs muted tabular-nums" aria-hidden="true">
                    <span>{max}</span>
                </div>
                <div
                    className="relative h-40 flex items-end gap-[2px] border-b border-black"
                    role="img"
                    aria-label={`${title}: ${plural(days.reduce((s, d) => s + d.plays, 0))} en ${days.length} días`}
                >
                    <div className="absolute inset-x-0 top-0 border-t border-dashed border-gray-300" aria-hidden="true" />
                    {days.map((day, index) => (
                        <div
                            key={day.date}
                            className="relative flex-1 h-full flex items-end cursor-default"
                            onMouseEnter={() => setHover(index)}
                            data-testid="day-column"
                        >
                            <div
                                className={`w-full rounded-t ${hover === index ? "bg-gray-600" : "bg-black"}`}
                                style={{ height: day.plays > 0 ? `max(2px, ${(day.plays / max) * 100}%)` : 0 }}
                            />
                        </div>
                    ))}
                </div>

                {active && (
                    <div
                        role="status"
                        className="pointer-events-none absolute top-0 z-10 border border-black bg-white px-2 py-1 text-xs shadow-sm whitespace-nowrap"
                        style={{
                            left: `${((hover + 0.5) / days.length) * 100}%`,
                            transform: `translateX(${hover < days.length / 2 ? "0" : "-100%"})`
                        }}
                    >
                        <span className="block muted first-letter:uppercase">{longDay(active.date)}</span>
                        <span className="font-semibold tabular-nums">{plural(active.plays)}</span>
                    </div>
                )}

                <div className="flex text-xs muted mt-1" aria-hidden="true">
                    {days.map((day, index) => (
                        <span key={day.date} className="flex-1 text-center overflow-visible whitespace-nowrap">
                            {(index === days.length - 1 || (days.length - 1 - index) % labelEvery === 0)
                                ? (index === days.length - 1 ? "Hoy" : shortDay(day.date))
                                : ""}
                        </span>
                    ))}
                </div>
            </div>

            <details className="mt-3 text-sm">
                <summary className="cursor-pointer muted">Ver como tabla</summary>
                <table className="mt-2 w-full text-left">
                    <caption className="sr-only">{title}</caption>
                    <thead>
                        <tr className="border-b border-black">
                            <th scope="col" className="py-1 font-semibold">Día</th>
                            <th scope="col" className="py-1 font-semibold text-right">Reproducciones ese día</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...days].reverse().map((day) => (
                            <tr key={day.date} className="border-b border-gray-200">
                                <td className="py-1 first-letter:uppercase">{longDay(day.date)}</td>
                                <td className="py-1 text-right tabular-nums">{day.plays}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </figure>
    );
}

/** Cambio entre dos períodos: "+40 %", "−25 %", "nueva" (antes 0) o "=" (igual). */
export function changeLabel(current, previous) {
    if (current === previous) return "=";
    if (previous === 0) return "nueva";
    const pct = Math.round(((current - previous) / previous) * 100);
    return pct > 0 ? `+${pct} %` : `−${Math.abs(pct)} %`;
}
