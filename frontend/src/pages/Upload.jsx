import UploadSong from "../components/UploadSong";

export default function Upload() {
    return (
        <div className="page">

            <h1 className="page-title mb-2">Subir canción</h1>
            <p className="muted mb-6 max-w-xl">
                Archivos .wav o .mp3. La subida responde enseguida y el audio se procesa aparte:
                en unos segundos queda publicado en el catálogo.
            </p>

            <UploadSong />

        </div>
    );
}
