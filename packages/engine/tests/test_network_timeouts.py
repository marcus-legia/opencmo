"""Speech-to-text refuses audio too large for one request before uploading a byte."""

import pytest

from opencmo.config import Config
from opencmo.steps import transcribe


def test_transcribe_rejects_oversized_audio_before_upload(tmp_path, monkeypatch):
    audio = tmp_path / "audio.m4a"
    audio.write_bytes(b"")
    with audio.open("r+b") as fh:
        fh.truncate(transcribe.TRANSCRIBE_MAX_BYTES + 1)

    def no_upload(*_a, **_k):
        raise AssertionError("không được upload file quá cỡ")

    monkeypatch.setattr(transcribe.httpx, "post", no_upload)
    with pytest.raises(RuntimeError, match="^Audio is too large to transcribe"):
        transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="k"))
