"""Own-video editing A3: the free, automatic transcript of a whole library file."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from opencmo.backends.supabase import Task
from opencmo.models import Transcript, TranscriptSegment, Word
from opencmo.worker import transcribe_asset_task

USER = "11111111-1111-4111-8111-111111111111"


def _media(path: Path, *, audio: bool = True, seconds: int = 4) -> Path:
    args = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=s=160x90:r=10:d={seconds}"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=f=440:d={seconds}", "-c:a", "aac", "-shortest"]
    subprocess.run([*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True)
    return path


def _row(**overrides) -> dict:
    return {
        "id": "asset-1", "user_id": USER, "job_id": "job-1", "status": "ready",
        "storage_path": "media/u/talk.mp4", "duration": 4, "name": "talk.mp4", **overrides,
    }


class FakeStore:
    def __init__(self, source: Path, row: dict) -> None:
        self.source = source
        self.row = row
        self.downloads: list[str] = []
        self.completed: tuple | None = None
        self.failed: list[tuple] = []

    def get_media_asset(self, _asset_id):
        return self.row

    def heartbeat_task(self, *_args):
        return True

    def download_object(self, bucket, path, dest, **_kwargs):
        self.downloads.append(f"{bucket}/{path}")
        dest.write_bytes(self.source.read_bytes())

    def complete_media_transcript(self, task_id, attempt_id, body, source):
        self.completed = (task_id, attempt_id, body, source)
        return "a" * 64

    def fail_task(self, *args):
        self.failed.append(args)
        return True


def _task() -> Task:
    return Task(
        id="task-1", user_id=USER, kind="transcribe_asset", clip_id=None, job_id="job-1", asset_id="asset-1",
        attempt_id="att-1", payload={"scope": "file", "auto": True, "credits": 0},
    )


def _words(seen: list[float], source: str = "scribe"):
    def transcribe(_asset: dict, audio: Path) -> Transcript:
        seconds = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(audio)],
            check=True, capture_output=True, text=True,
        ).stdout
        seen.append(float(seconds))
        words = [Word(0.4, 0.6, "um"), Word(1.0, 1.3, "hello"), Word(1.4, 1.8, "there")]
        return Transcript(segments=[TranscriptSegment(0.4, 1.8, "um hello there", words)], source=source)

    return transcribe


def test_transcribes_the_whole_file_in_file_seconds(tmp_path, monkeypatch):
    seen: list[float] = []
    monkeypatch.setattr(transcribe_asset_task, "transcribe", _words(seen))
    store = FakeStore(_media(tmp_path / "talk.mp4"), _row())
    transcribe_asset_task.process(store, _task())

    assert not store.failed
    assert store.downloads == ["media/u/talk.mp4"]
    assert abs(seen[0] - 4.0) < 0.15  # the whole file, not a window
    task_id, attempt_id, body, source = store.completed
    assert (task_id, attempt_id, source) == ("task-1", "att-1", "scribe")
    words = json.loads(body)[0]["words"]
    assert [word["text"] for word in words] == ["um", "hello", "there"]
    assert [word["start"] for word in words] == [0.4, 1.0, 1.4]


def test_a_non_scribe_transcript_is_labelled_fake(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe_asset_task, "transcribe", _words([], source="whisper"))
    store = FakeStore(_media(tmp_path / "talk.mp4"), _row())
    transcribe_asset_task.process(store, _task())
    assert store.completed[3] == "fake"


def test_no_speech_is_an_empty_transcript_not_a_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe_asset_task, "transcribe", lambda *_: Transcript(segments=[]))
    store = FakeStore(_media(tmp_path / "talk.mp4"), _row())
    transcribe_asset_task.process(store, _task())
    assert not store.failed
    assert store.completed[2] == "[]"


def test_refusals_say_why_in_english(tmp_path, monkeypatch):
    monkeypatch.setattr(transcribe_asset_task, "transcribe", _words([]))
    mute = FakeStore(_media(tmp_path / "mute.mp4", audio=False), _row())
    transcribe_asset_task.process(mute, _task())
    assert mute.failed[0][2] == transcribe_asset_task.NO_AUDIO

    other = FakeStore(tmp_path / "mute.mp4", _row(user_id="someone-else"))
    transcribe_asset_task.process(other, _task())
    assert other.downloads == []
    assert other.failed[0][2] == transcribe_asset_task.GONE

    long = FakeStore(tmp_path / "mute.mp4", _row(duration=transcribe_asset_task.MAX_SECONDS + 1))
    transcribe_asset_task.process(long, _task())
    assert long.downloads == []
    assert long.failed[0][2] == transcribe_asset_task.TOO_LONG
