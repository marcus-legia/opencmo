"""An uploaded video becomes one editable project: master, transcript, one `full` clip."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from opencmo.backends.supabase import Job
from opencmo.models import Transcript, TranscriptSegment, Word
from opencmo.worker import job_uploads, process_job


class FakeStore:
    def __init__(self, *, publish: bool = True, source_size: int = 1024) -> None:
        self.rows: list[dict] = []
        self.source_size = source_size
        self.publish = publish
        self.calls: list[tuple] = []
        self.removed: list[tuple[str, list[str]]] = []

    def list_clips(self, _job):
        return self.rows

    def heartbeat(self, *_args):
        return True

    def settle(self, *args, **kwargs):
        self.calls.append(("settle", args, kwargs))

    def update_job_stage(self, _job, _attempt, stage):
        self.calls.append(("stage", stage))

    def upload_object(self, bucket, path, _file, **_kwargs):
        self.calls.append(("upload", bucket, path))
        return path

    def download_object(self, bucket, path, dest, **_kwargs):
        self.calls.append(("download", bucket, path))
        dest.write_bytes(b"source")

    def sign_object_url(self, bucket, path, expires_in=3600):
        self.calls.append(("sign", bucket, path))
        return f"https://storage.test/{bucket}/{path}?token=fake"

    def object_info(self, _bucket, _path):
        return {"size": self.source_size}

    def complete_job_publication(self, *_args, **kwargs):
        self.calls.append(("publish", kwargs))
        return self.publish

    def fail(self, _job, _attempt, error):
        self.calls.append(("fail", error))
        return {"transitioned": True}

    def remove_objects(self, bucket, paths):
        self.calls.append(("remove", bucket, paths))
        self.removed.append((bucket, paths))

    def get_job_row(self, _job):
        return {"status": "running", "attempt_id": "attempt-1"}


def _job(**overrides) -> Job:
    values = {
        "id": "job-1", "user_id": "user-1", "source_url": "storage://user-1/talk__abc.mp4",
        "clips_requested": 1, "attempt": 1, "attempt_id": "attempt-1",
    }
    values.update(overrides)
    return Job(**values)


@pytest.fixture
def media(monkeypatch):
    """ffmpeg and Scribe stand-ins: the probe says 300 s, the master is a copy, Scribe hears words."""
    said = {
        "transcript": Transcript(segments=[TranscriptSegment(0.0, 1.0, "Hi there", words=[Word(0.0, 0.5, "Hi"), Word(0.5, 1.0, "there")])]),
        "header": 300.0,
        "master": 300.0,
        "probes": [],
    }

    def probe(path, **kwargs):
        said["probes"].append((path, kwargs))
        seconds = said["master"] if str(path).endswith("master.mp4") else said["header"]
        return SimpleNamespace(duration=seconds, width=1920, height=1080)

    monkeypatch.setattr(process_job, "probe_file", probe)

    def master(_source, out, **_kwargs):
        out.write_bytes(b"master")

    def preview(_source, out, **_kwargs):
        out.write_bytes(b"preview")
        return out

    def audio(_source, target, **_kwargs):
        target.write_bytes(b"audio")
        return target

    def transcribe(_audio, _cfg):
        if isinstance(said["transcript"], Exception):
            raise said["transcript"]
        return said["transcript"]

    monkeypatch.setattr(process_job, "make_editor_master", master)
    monkeypatch.setattr(process_job, "preview_head", preview)
    monkeypatch.setattr(process_job, "extract_audio", audio)
    monkeypatch.setattr(process_job, "transcribe_audio", transcribe)
    return said


def _published(store: FakeStore) -> dict:
    return next(call[1] for call in store.calls if call[0] == "publish")


def test_upload_publishes_one_full_clip_with_master_transcript_and_settings(media):
    store = FakeStore()
    process_job.process(store, _job())

    published = _published(store)
    (clip,) = published["clips"]
    assert clip["idx"] == 0 and clip["end_seconds"] == 300.0 and clip["preview_path"]
    assert clip["storage_path"] is None, "the master is the video; nothing is copied to the clips bucket"
    (revision,) = published["revisions"]
    assert revision["clip_id"] == clip["id"] and len(revision["settings_hash"]) == 64
    master = published["manifest"]["masters"][clip["id"]]
    assert master["bucket"] == "renders" and master["object"].startswith(f"user-1/{clip['id']}/master/")
    assert master["transcript"].endswith(".transcript.json")
    assert published["title"] == "talk__abc.mp4"
    assert not [call for call in store.calls if call[0] == "fail"]


def test_upload_is_charged_on_its_length_before_any_download(media):
    store = FakeStore()
    process_job.process(store, _job())
    names = [call[0] for call in store.calls]
    settled = next(call for call in store.calls if call[0] == "settle")
    assert settled[1][1] == 300.0
    assert names.index("settle") < names.index("download")


def test_a_failed_transcript_still_gives_an_editable_video_without_captions(media):
    media["transcript"] = RuntimeError("Speech-to-text returned 500: down")
    store = FakeStore()
    process_job.process(store, _job())
    published = _published(store)
    clip_id = published["clips"][0]["id"]
    assert published["manifest"]["masters"][clip_id]["transcript"] is None
    assert published["revisions"][0]["settings"]["captions"] is False


def test_a_video_longer_than_the_editor_holds_fails_before_charging(media, monkeypatch):
    monkeypatch.setattr(process_job, "MAX_EDIT_SECONDS", 120.0)
    store = FakeStore()
    process_job.process(store, _job())
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert "Videos up to 2 minutes" in failure
    assert not [call for call in store.calls if call[0] in ("settle", "download")]


def test_the_upload_url_is_probed_through_the_demuxer_allowlist(media):
    process_job.process(FakeStore(), _job())
    (_url, kwargs), _master = media["probes"]
    assert kwargs == {"user_url": True}


@pytest.mark.parametrize("header", [0.0, float("nan")])
def test_a_video_without_a_readable_length_fails_before_charging(media, header):
    media["header"] = header
    store = FakeStore()
    process_job.process(store, _job())
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert failure == process_job.LENGTH_UNKNOWN
    assert not [call for call in store.calls if call[0] in ("settle", "download")]


def test_a_master_longer_than_its_header_fails_and_publishes_nothing(media):
    media["header"], media["master"] = 10.0, 7200.0
    store = FakeStore()
    process_job.process(store, _job())
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert "minutes can be edited" in failure
    assert not [call for call in store.calls if call[0] == "publish"]


def test_a_master_that_disagrees_with_the_billed_length_fails(media):
    media["header"], media["master"] = 10.0, 60.0
    store = FakeStore()
    process_job.process(store, _job())
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert failure == process_job.LENGTH_MISMATCH


def test_an_upload_over_the_size_limit_fails_before_charging(media, monkeypatch):
    monkeypatch.setattr(process_job, "MAX_UPLOAD_BYTES", 512)
    store = FakeStore(source_size=4096)
    process_job.process(store, _job())
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert "upload limit" in failure
    assert not [call for call in store.calls if call[0] == "settle"]


def test_a_link_source_is_refused(media):
    store = FakeStore()
    process_job.process(store, _job(source_url="https://youtube.com/watch?v=x"))
    (failure,) = [call[1] for call in store.calls if call[0] == "fail"]
    assert failure == "Upload the video file to edit it."


def test_retry_keeps_the_published_clip_id(media):
    store = FakeStore()
    store.rows = [{"id": "clip-kept", "idx": 0}]
    process_job.process(store, _job())
    assert _published(store)["clips"][0]["id"] == "clip-kept"


def test_the_upload_is_removed_only_after_the_publication_commits(media):
    store = FakeStore()
    process_job.process(store, _job())
    assert ("sources", ["user-1/talk__abc.mp4"]) in store.removed
    names = [call[0] for call in store.calls]
    assert names.index("publish") < names.index("remove")


def test_a_lost_lease_publishes_nothing_and_cleans_up(media):
    store = FakeStore(publish=False)
    process_job.process(store, _job())
    assert not [call for call in store.calls if call[0] == "fail"]
    assert store.removed, "objects put by a stale attempt are removed"
    assert ("sources", ["user-1/talk__abc.mp4"]) not in store.removed


def test_cleanup_keeps_files_if_publication_readback_is_unavailable():
    store = FakeStore()
    store.list_clips = lambda _: (_ for _ in ()).throw(ConnectionError("offline"))
    job_uploads.cleanup(store, {"clips": ["maybe-published.mp4"]}, "job-1")
    assert store.removed == []
