"""ElevenLabs Scribe: request shape and how words become segments."""

from __future__ import annotations

import pytest

from opencmo.config import Config
from opencmo.models import Word
from opencmo.steps import transcribe

_REAL_DURATION = {
    "test_long_audio_is_sent_in_parallel_parts_and_merged_in_source_time",
    "test_part_cutting_and_probe_use_the_demuxer_allowlist",
    "test_unreadable_audio_is_refused_before_any_call",
}


@pytest.fixture(autouse=True)
def _short_audio(monkeypatch, request):
    """Most cases send a few bytes as "audio": give them a readable 5 s length."""
    if request.node.name not in _REAL_DURATION:
        monkeypatch.setattr(transcribe, "_duration", lambda _path: 5.0)


def _word(text: str, start: float, end: float) -> dict:
    return {"text": text, "start": start, "end": end, "type": "word"}


def test_sends_word_timestamps_request_with_api_key(monkeypatch, tmp_path):
    seen = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "language_code": "vie",
                "words": [
                    _word("Xin", 0.0, 0.3), {"text": " ", "start": 0.3, "end": 0.35, "type": "spacing"},
                    _word("chào.", 0.35, 0.8), {"text": "(laughs)", "start": 0.9, "end": 1.0, "type": "audio_event"},
                ],
            }

    def post(url, **kwargs):
        seen.update(url=url, **kwargs)
        return Response()

    monkeypatch.setattr(transcribe.httpx, "post", post)
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"audio")
    transcript = transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="xi"))

    assert seen["url"].endswith("/v1/speech-to-text")
    assert seen["headers"] == {"xi-api-key": "xi"}
    assert seen["data"]["timestamps_granularity"] == "word"
    assert transcript.language == "vi"
    assert [segment.text for segment in transcript.segments] == ["Xin chào."]
    assert [word.text for word in transcript.segments[0].words] == ["Xin", "chào."]


def test_segments_break_on_sentence_end_pause_and_length():
    words = [
        Word(0.0, 0.4, "First"), Word(0.4, 0.9, "line."),
        Word(1.0, 1.4, "After"), Word(1.4, 1.8, "a"),
        Word(3.0, 3.5, "pause"),
    ] + [Word(5.0 + i, 5.9 + i, "long") for i in range(14)]
    segments = transcribe.segments_from_words(words)

    assert [segment.text for segment in segments[:3]] == ["First line.", "After a", "pause"]
    assert all(segment.end - segment.start <= 12.0 for segment in segments)
    assert sum(len(segment.words) for segment in segments) == len(words)


def test_error_status_uses_the_mapped_prefix(monkeypatch, tmp_path):
    class Response:
        status_code = 429
        text = "busy"

    monkeypatch.setattr(transcribe.httpx, "post", lambda *_a, **_k: Response())
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"audio")
    with pytest.raises(RuntimeError, match="^Speech-to-text returned 429"):
        transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="xi"))


def test_missing_key_fails_clearly(tmp_path):
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"audio")
    with pytest.raises(RuntimeError, match="ELEVENLABS_API_KEY"):
        transcribe.transcribe_audio(audio, Config(elevenlabs_api_key=""))


def test_real_scribe_response_becomes_sentence_segments(monkeypatch, tmp_path):
    """`fixtures/live/elevenlabs-scribe.json` is a real Scribe answer (synthetic speech), 2026-10-11."""
    import json
    from pathlib import Path

    body = json.loads((Path(__file__).parent / "fixtures" / "live" / "elevenlabs-scribe.json").read_text())

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return body

    monkeypatch.setattr(transcribe.httpx, "post", lambda *_a, **_k: Response())
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"x")
    result = transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="k"))
    assert result.language == "en" and result.source == "scribe"
    assert [segment.text for segment in result.segments][:2] == ["Hello there.", "This is a short test of speech-to-text."]
    assert all(segment.words for segment in result.segments), "every segment keeps its word timings"
    assert " " not in [word.text for segment in result.segments for word in segment.words or []]


def test_long_audio_is_sent_in_parallel_parts_and_merged_in_source_time(monkeypatch, tmp_path):
    import subprocess

    audio = tmp_path / "audio.m4a"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "25", "-c:a", "aac", "-b:a", "32k", str(audio)], check=True)
    monkeypatch.setattr(transcribe, "CHUNK_SECONDS", 10.0)
    sent: list[str] = []

    class Response:
        status_code = 200

        def __init__(self, name):
            self.name = name

        def json(self):
            index = int(self.name.removeprefix("part").split(".")[0])
            # Parts 1 and 2 are cut 2 s before their window: they also hear the end of the previous
            # window (1 s in) and their own word 3 s in. Parts 0 and 1 hear past their window's end.
            if index == 0:
                return {"language_code": "eng", "words": [_word("w0.", 1.0, 1.4), _word("tail0", 10.5, 10.8)]}
            tail = [_word(f"tail{index}", 12.5, 12.8)] if index < 2 else []  # the last part ends with the audio
            return {"language_code": "eng", "words": [_word(f"lead{index}", 1.0, 1.3), _word(f"w{index}.", 3.0, 3.4), *tail]}

    def post(_url, *, files, **_kwargs):
        name = files["file"][0]
        sent.append(name)
        return Response(name)

    monkeypatch.setattr(transcribe.httpx, "post", post)
    result = transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="k"))
    assert sorted(sent) == ["part0.m4a", "part1.m4a", "part2.m4a"]
    words = [(word.text, round(word.start, 1)) for segment in result.segments for word in segment.words or []]
    assert words == [("w0.", 1.0), ("w1.", 11.0), ("w2.", 21.0)], "overlap words dropped, times shifted"


def test_chunk_starts_and_merge():
    assert transcribe.chunk_starts(5.0) == [0.0]
    assert transcribe.chunk_starts(1250.0) == [0.0, 600.0, 1200.0]
    assert transcribe.cut_start(0.0) == 0.0 and transcribe.cut_start(600.0) == 598.0
    merged = transcribe.merge_parts([
        (0.0, 0.0, [Word(599.5, 599.7, "a"), Word(599.8, 600.4, "marketing"), Word(600.5, 601.0, "dup")]),
        # Part 1 is cut at 598 s: it hears "marketing" whole at 1.8 s and "b" at 2.5 s.
        (600.0, 598.0, [Word(1.8, 2.4, "marketing"), Word(2.5, 3.0, "b")]),
    ])
    assert [(w.text, w.start) for w in merged] == [("a", 599.5), ("marketing", 599.8), ("b", 600.5)]


def test_a_word_on_the_cut_is_kept_once_even_when_the_next_part_hears_a_fragment():
    """A part cut mid-word hears a fragment at its very start; it falls before the part's window."""
    merged = transcribe.merge_parts([
        (0.0, 0.0, [Word(599.8, 600.4, "marketing")]),
        (600.0, 598.0, [Word(0.0, 0.3, "ting"), Word(1.8, 2.4, "marketing"), Word(2.6, 3.0, "works.")]),
    ])
    assert [w.text for w in merged] == ["marketing", "works."]


def test_words_are_shifted_by_where_the_copy_really_starts():
    """A stream copy of a WebM cut at 598 s starts at the cluster before it (595 s here)."""
    merged = transcribe.merge_parts([(0.0, 0.0, []), (600.0, 594.994, [Word(8.008, 8.1, "beep")])])
    assert [round(w.start, 3) for w in merged] == [603.002]


def test_a_webm_part_reports_its_real_first_second(tmp_path):
    import subprocess

    source = tmp_path / "a.webm"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=40", "-c:a", "libopus", "-b:a", "32k", str(source)], check=True)
    part, first = transcribe._cut_part(source, 20.0, tmp_path, 1)
    assert first <= 18.0 + 0.05, "never later than the requested cut"
    assert abs(transcribe._first_packet(part)) < 0.05, "the part itself starts at 0"


def test_audio_longer_than_the_part_cap_is_refused_before_any_call(monkeypatch, tmp_path):
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"x")
    monkeypatch.setattr(transcribe, "_duration", lambda _p: transcribe.CHUNK_SECONDS * (transcribe.MAX_PARTS + 1))
    monkeypatch.setattr(transcribe.httpx, "post", lambda *_a, **_k: pytest.fail("no paid call"))
    with pytest.raises(RuntimeError, match="^Audio is too large to transcribe"):
        transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="k"))


def test_part_cutting_and_probe_use_the_demuxer_allowlist(monkeypatch, tmp_path):
    from opencmo.media.ffmpeg import USER_INPUT

    seen: list[list[str]] = []

    def fake_run(args, **_kwargs):
        seen.append(args)
        raise RuntimeError("stop")

    monkeypatch.setattr(transcribe, "run", fake_run)
    assert transcribe._duration(tmp_path / "a.m4a") is None
    assert all(flag in seen[0] for flag in USER_INPUT)


def test_unreadable_audio_is_refused_before_any_call(monkeypatch, tmp_path):
    audio = tmp_path / "a.m4a"
    audio.write_bytes(b"not audio")
    monkeypatch.setattr(transcribe.httpx, "post", lambda *_a, **_k: pytest.fail("no paid call"))
    with pytest.raises(RuntimeError, match="^Could not read the audio"):
        transcribe.transcribe_audio(audio, Config(elevenlabs_api_key="k"))
