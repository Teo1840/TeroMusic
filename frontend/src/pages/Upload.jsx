import UploadSong from "../components/UploadSong";

export default function Upload() {
    return (
        <div className="page max-w-xl">

            <h1 className="page-title mb-2">Subir canción</h1>
            <p className="muted mb-6">
                Archivos .wav o .mp3. La subida responde enseguida y el audio se procesa aparte:
                en unos segundos queda publicado en el catálogo.
            </p>

            <UploadSong />

        </div>
    );
}
