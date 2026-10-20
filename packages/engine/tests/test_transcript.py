from opencmo.models import Transcript, TranscriptSegment
from opencmo.steps import transcribe


def test_transcript_slice_rebases_to_zero():
    t = Transcript(
        segments=[
            TranscriptSegment(0.0, 5.0, "trước"),
            TranscriptSegment(10.0, 12.0, "trong"),
            TranscriptSegment(30.0, 32.0, "sau"),
        ]
    )
    sliced = t.slice(9.0, 20.0)

    assert len(sliced) == 1
    assert sliced[0].text == "trong"
    assert sliced[0].start == 1.0  # 10.0 - 9.0
    assert sliced[0].end == 3.0


def test_transcript_slice_clamps_overhanging_segments():
    t = Transcript(segments=[TranscriptSegment(5.0, 25.0, "dài")])
    sliced = t.slice(10.0, 20.0)
    assert sliced[0].start == 0.0
    assert sliced[0].end == 10.0


def test_music_with_empty_speech_to_text_result_is_a_valid_empty_transcript(monkeypatch, tmp_path):
    """Nhạc không lời không phải lỗi transcription."""
    from opencmo.config import Config

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"words": [], "language_code": "eng", "text": ""}

    monkeypatch.setattr(transcribe.httpx, "post", lambda *_args, **_kwargs: Response())
    monkeypatch.setattr(transcribe, "_duration", lambda _path: 5.0)
    audio = tmp_path / "music.m4a"
    audio.write_bytes(b"audio")

    transcript = transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="test"))

    assert transcript.segments == []
    assert transcript.source == "scribe"
    assert transcript.language == "en"
