export default function AudioPlayer({
    songId
}) {

    const token =
        localStorage.getItem("access_token");

    const url =
        `/api/v1/audio/${songId}/stream`;

    return (
        <audio
            controls
            preload="metadata"
            src={url}
        />
    );
}