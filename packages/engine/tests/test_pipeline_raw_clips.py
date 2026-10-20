"""Raw clips when captions cannot be made (plan item 8, Session B6).

On the picked-moments branch the sections are already cut when speech-to-text runs. A Scribe
error (no key, empty quota, network) used to fail the whole job; now the clips come out without
captions and the user can add them later with Inspector → Generate captions.
"""

from pathlib import Path
from types import SimpleNamespace

from opencmo import pipeline
from opencmo.config import Config
from opencmo.models import Moment, SourceInfo, Transcript, TranscriptSegment, Word


def _stub(monkeypatch, transcribe_audio) -> dict:
    seen: dict = {"render": None}
    source = SourceInfo(url="https://youtu.be/x", title="Talk", duration=3240.0)

    def download_sections(_url, moments, _cfg, _work):
        return [(Path(f"/tmp/section_{i:02d}.mp4"), 1.0) for i, _ in enumerate(moments)]

    def render_all(sections, moments, transcript, *_args, **_kwargs):
        seen["render"] = (list(moments), transcript)
        return [SimpleNamespace(index=i) for i, _ in enumerate(moments)]

    monkeypatch.setattr(pipeline, "require_binaries", lambda: None)
    monkeypatch.setattr(pipeline, "extract_audio", lambda _s, target, **_k: Path(target))
    monkeypatch.setattr(pipeline.encoder_mod, "detect", lambda _p: SimpleNamespace(name="libx264"))
    monkeypatch.setattr(pipeline.download, "probe", lambda _url, _cfg: source)
    monkeypatch.setattr(pipeline.download, "fetch_subtitles", lambda *_a, **_k: None)
    monkeypatch.setattr(pipeline.download, "download_sections", download_sections)
    monkeypatch.setattr(pipeline.transcribe, "transcribe_audio", transcribe_audio)
    monkeypatch.setattr(pipeline.render, "render_all", render_all)
    return seen


def _part() -> Transcript:
    return Transcript(
        segments=[TranscriptSegment(1.0, 3.0, "hello there", words=[Word(1.0, 2.0, "hello"), Word(2.0, 3.0, "there")])],
        language="en",
        source="scribe",
    )


MOMENTS = [Moment(600.0, 640.0, "Clip 1"), Moment(1200.0, 1230.0, "Clip 2")]


def test_scribe_failing_everywhere_still_returns_every_clip(monkeypatch, tmp_path):
    def broken(_audio, _cfg):
        raise RuntimeError("ElevenLabs quota exceeded")

    seen = _stub(monkeypatch, broken)
    artifacts: dict = {}

    result = pipeline.run_pipeline(
        "https://youtu.be/x", Config(out_dir=tmp_path), moments=MOMENTS,
        on_artifact=lambda kind, data: artifacts.__setitem__(kind, data),
    )

    assert len(result.clips) == 2
    moments, transcript = seen["render"]
    assert moments == MOMENTS
    assert transcript.segments == []
    # Same shape as before: `clipping-types.ts` and the SQL checks see a Scribe transcript, empty.
    assert transcript.source == "scribe"
    assert artifacts["transcript"]["segments"] == []


def test_only_the_section_scribe_could_read_gets_captions(monkeypatch, tmp_path):
    calls = {"n": 0}

    def flaky(_audio, _cfg):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("connection reset")
        return _part()

    seen = _stub(monkeypatch, flaky)

    result = pipeline.run_pipeline("https://youtu.be/x", Config(out_dir=tmp_path), moments=MOMENTS)

    assert len(result.clips) == 2
    transcript = seen["render"][1]
    # First moment only, shifted to the video's timeline (600 + 1).
    assert [(s.start, s.end) for s in transcript.segments] == [(601.0, 603.0)]
    assert transcript.slice(1200.0, 1230.0) == []
