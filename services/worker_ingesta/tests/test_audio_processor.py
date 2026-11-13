"""Pipeline de FFmpeg con audio real generado en el test (sin archivos de ejemplo).

Necesita ffmpeg y ffprobe: corren dentro de la imagen del worker (ver README).
"""
import json
import shutil
import subprocess

import pytest

from app import audio_processor
from app.audio_processor import ProcessingError, probe, process_audio

pytestmark = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="hace falta ffmpeg"
)


def make_audio(path, seconds=2, extra=()):
    """Tono de 440 Hz con FFmpeg (lavfi). El formato sale de la extensión de `path`."""
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", *extra, str(path)],
        check=True,
    )
    return path


@pytest.mark.parametrize("name", ["original.wav", "original.mp3"])
def test_genera_dos_mp3_y_la_forma_de_onda(tmp_path, name):
    src = make_audio(tmp_path / name)
    out = tmp_path / "out"

    result = process_audio(src, out)

    assert result["duration_sec"] == pytest.approx(2, abs=0.1)
    assert [r["bitrate_kbps"] for r in result["renditions"]] == [128, 320]
    for rendition in result["renditions"]:
        file = out / rendition["filename"]
        assert file.exists()
        assert rendition["size_bytes"] == file.stat().st_size > 0
        assert rendition["codec"] == "mp3"
        # Es un MP3 de verdad, con la duración del original.
        assert probe(file) == pytest.approx(2, abs=0.2)

    # 320 kbps pesa más que 128.
    sizes = {r["bitrate_kbps"]: r["size_bytes"] for r in result["renditions"]}
    assert sizes[320] > sizes[128]

    waveform = json.loads((out / "waveform.json").read_text())
    assert waveform["version"] == 1
    assert waveform["points"] == result["waveform_points"] == 200
    assert len(waveform["peaks"]) == 200
    assert all(0 <= peak <= 1 for peak in waveform["peaks"])
    assert max(waveform["peaks"]) > 0.1  # el tono se ve, no es silencio


# BUG CONOCIDO: con silencio total, loudnorm deja valores inválidos y LAME aborta
# ("psymodel.c: calc_energy: Assertion `el >= 0' failed") → la canción queda FALLIDO.
# Arreglo posible: si el audio es silencio (ver volumedetect), convertir sin loudnorm.
# strict=True: cuando se arregle, este test "pasa de golpe" y avisa que hay que sacar la marca.
@pytest.mark.xfail(strict=True, reason="loudnorm + LAME fallan con silencio total")
def test_silencio_da_forma_de_onda_plana(tmp_path):
    src = tmp_path / "silencio.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "1", str(src)],
        check=True,
    )
    result = process_audio(src, tmp_path / "out")
    peaks = json.loads((tmp_path / "out" / "waveform.json").read_text())["peaks"]
    assert result["waveform_points"] == 200
    assert max(peaks) == 0


def test_archivo_corrupto_falla_sin_reintento(tmp_path):
    src = tmp_path / "roto.wav"
    src.write_bytes(b"esto no es audio" * 100)

    with pytest.raises(ProcessingError) as error:
        process_audio(src, tmp_path / "out")

    assert error.value.code == "CORRUPT_FILE"
    assert error.value.retryable is False


def test_archivo_sin_audio_no_se_acepta(tmp_path):
    src = tmp_path / "solo_video.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", str(src)],
        check=True,
    )
    with pytest.raises(ProcessingError) as error:
        probe(src)
    assert error.value.code == "UNSUPPORTED_FORMAT"


def test_demasiado_largo_se_rechaza_antes_de_convertir(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_processor, "MAX_DURATION_SEC", 1)
    src = make_audio(tmp_path / "largo.wav", seconds=2)

    with pytest.raises(ProcessingError) as error:
        process_audio(src, tmp_path / "out")

    assert error.value.code == "TOO_LONG"
    assert not (tmp_path / "out" / "128.mp3").exists()


def test_sin_ffmpeg_instalado_falla_con_codigo_del_contrato(monkeypatch, tmp_path):
    monkeypatch.setenv("PATH", "")
    with pytest.raises(ProcessingError) as error:
        probe(tmp_path / "x.wav")
    assert error.value.code == "TRANSCODE_ERROR"


def test_playlist_hls_disfrazada_de_mp3_no_pide_urls(tmp_path):
    # Si FFmpeg adivinara el formato, abriría la URL (SSRF). Con -f mp3 es un MP3 roto.
    src = tmp_path / "trampa.mp3"
    src.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/x.mp3\n#EXT-X-ENDLIST\n")

    with pytest.raises(ProcessingError) as error:
        probe(src)

    assert error.value.code == "CORRUPT_FILE"
