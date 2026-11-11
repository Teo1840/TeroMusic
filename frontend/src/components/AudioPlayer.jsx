import { useRef } from "react";
import { usePlayTracking, useSignedStreamUrl } from "../lib/audio";

export default function AudioPlayer({ songId }) {

    const audioRef = useRef(null);
    const { src, onError, onLoadedData } = useSignedStreamUrl(songId, audioRef);
    const tracking = usePlayTracking(songId, audioRef);

    if (!src) {
        return <p className="text-sm text-gray-500">Cargando audio...</p>;
    }

    return (
        <audio
            ref={audioRef}
            controls
            preload="metadata"
            src={src}
            onError={onError}
            onLoadedData={onLoadedData}
            {...tracking}
        />
    );
}
