/**
 * Íconos SVG en línea (sin emojis: se ven igual en todos los sistemas).
 * Usan currentColor, así toman el color del texto que los rodea.
 * Decorativos (aria-hidden): siempre van junto a un texto o con aria-label en el botón.
 */

function Icon({ size = 16, className = "", children }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
            className={`inline-block shrink-0 align-[-0.125em] ${className}`}
        >
            {children}
        </svg>
    );
}

export function PlayIcon(props) {
    return (
        <Icon {...props}>
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
        </Icon>
    );
}

export function PauseIcon(props) {
    return (
        <Icon {...props}>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
        </Icon>
    );
}

export function VolumeIcon(props) {
    return (
        <Icon {...props}>
            <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.4 3.67A1 1 0 0 0 14 18.4V5.6a1 1 0 0 0-1.6-.77L8 8.5H5a1 1 0 0 0-1 1z" />
            <path
                d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </Icon>
    );
}

export function VolumeOffIcon(props) {
    return (
        <Icon {...props}>
            <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.4 3.67A1 1 0 0 0 14 18.4V5.6a1 1 0 0 0-1.6-.77L8 8.5H5a1 1 0 0 0-1 1z" />
            <path
                d="M17 9.5l5 5M22 9.5l-5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </Icon>
    );
}

/** Íconos de trazo (líneas) para acciones de lista. */
function StrokeIcon({ children, ...props }) {
    return (
        <Icon {...props}>
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {children}
            </g>
        </Icon>
    );
}

export function NextIcon(props) {
    return (
        <Icon {...props}>
            <path d="M5 6.14v11.72a1 1 0 0 0 1.52.85l9.2-5.86a1 1 0 0 0 0-1.7l-9.2-5.86A1 1 0 0 0 5 6.14z" />
            <rect x="17" y="5" width="2.5" height="14" rx="1" />
        </Icon>
    );
}

export function ArrowUpIcon(props) {
    return <StrokeIcon {...props}><path d="M12 19V5M6 11l6-6 6 6" /></StrokeIcon>;
}

export function ArrowDownIcon(props) {
    return <StrokeIcon {...props}><path d="M12 5v14M6 13l6 6 6-6" /></StrokeIcon>;
}

export function CloseIcon(props) {
    return <StrokeIcon {...props}><path d="M6 6l12 12M18 6L6 18" /></StrokeIcon>;
}

export function CheckIcon(props) {
    return <StrokeIcon {...props}><path d="M5 12.5l4.5 4.5L19 7.5" /></StrokeIcon>;
}

export function MenuIcon(props) {
    return <StrokeIcon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></StrokeIcon>;
}

export function PlusIcon(props) {
    return <StrokeIcon {...props}><path d="M12 5v14M5 12h14" /></StrokeIcon>;
}

/** Play o pausa según el estado. */
export function PlaybackIcon({ playing, ...props }) {
    return playing ? <PlayIcon {...props} /> : <PauseIcon {...props} />;
}
