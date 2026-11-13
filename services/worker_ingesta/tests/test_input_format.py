"""Entrada de FFmpeg: el formato sale de la extensión y solo se abren archivos locales.

Evita que un archivo subido (por ejemplo una playlist HLS con extensión .mp3) haga que
FFmpeg pida URLs de la red interna. No necesita ffmpeg instalado.
"""
from pathlib import Path

import pytest

from app import audio_processor
from app.audio_processor import ProcessingError, _input


@pytest.mark.parametrize("name, fmt", [("a.wav", "wav"), ("a.MP3", "mp3")])
def test_fuerza_formato_y_solo_protocolo_file(name, fmt):
    args = _input(Path(name))
    assert args[:4] == ["-protocol_whitelist", "file", "-f", fmt]
    assert args[-2] == "-i"


@pytest.mark.parametrize("name", ["a.m3u8", "a.mp4", "a"])
def test_extension_no_soportada_falla_sin_reintento(name):
    with pytest.raises(ProcessingError) as error:
        _input(Path(name))
    assert error.value.code == "UNSUPPORTED_FORMAT"
    assert error.value.retryable is False


def test_todos_los_comandos_usan_la_entrada_segura(monkeypatch, tmp_path):
    commands = []

    def fake_run(cmd, error_code):
        commands.append(cmd)
        raise ProcessingError("STOP", "corta acá")

    monkeypatch.setattr(audio_processor, "_run", fake_run)
    src = tmp_path / "x.mp3"
    for step in (
        lambda: audio_processor.probe(src),
        lambda: audio_processor.transcode(src, tmp_path / "o.mp3", 128),
        lambda: audio_processor.make_waveform(src, tmp_path / "w.json"),
    ):
        with pytest.raises(ProcessingError):
            step()
    assert len(commands) == 3
    for cmd in commands:
        i = cmd.index("-i")
        assert cmd[i - 4:i] == ["-protocol_whitelist", "file", "-f", "mp3"]
