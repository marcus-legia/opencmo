"""A clip job without picked moments fails before any download or model call (plan item 1, A5).

The last of three gates: zod in `createClipJob` and `create_job()` refuse it first, but a job row
written before the gate shipped, or by a path that skipped both, must still never reach the
engine's `select` step.
"""

from __future__ import annotations

import pytest

from opencmo.backends.supabase import Job
from opencmo.worker import process_job

JOB = "5a1e0000-0000-4000-8000-000000000001"


class FakeStore:
    def __init__(self, artifacts: list[dict] | None = None) -> None:
        self.failed: list[str] = []
        self._artifacts = artifacts or []

    def __getattr__(self, name):
        # Lease, heartbeat and cleanup calls the run makes on the way in and out.
        return lambda *_args, **_kwargs: None

    def list_clips(self, _job_id):
        return []

    def list_artifacts(self, _job_id, kind):
        return self._artifacts if kind == "moments" else []

    def get_job_row(self, _job_id):
        return {"status": "running", "attempt_id": None}

    def fail(self, _job_id, _attempt_id, error):
        self.failed.append(error)


def _never(*_args, **_kwargs):
    raise AssertionError("must not run")


@pytest.fixture
def guarded(monkeypatch):
    monkeypatch.setattr(process_job, "run_pipeline", _never)
    monkeypatch.setattr(process_job, "resolve_web_source", _never)
    monkeypatch.setattr(process_job, "validate_public_url", _never)


@pytest.mark.parametrize("source", ["https://youtu.be/abc", "storage://media/u/talk.mp4"])
def test_clip_job_without_moments_fails_before_download(guarded, source):
    store = FakeStore()
    process_job.process(store, Job(id=JOB, user_id="u", source_url=source, clips_requested=5))
    assert store.failed == ["Pick at least one moment to clip."]


def test_empty_segments_count_as_none(guarded):
    store = FakeStore()
    job = Job(id=JOB, user_id="u", source_url="https://youtu.be/abc", clips_requested=5, segments=None)
    process_job.process(store, job)
    assert store.failed == ["Pick at least one moment to clip."]


def test_picked_moments_pass_the_gate(monkeypatch):
    # Past the gate the run resolves the source; stop it there.
    reached = []

    def stop(url):
        reached.append(url)
        raise RuntimeError("stop here")

    monkeypatch.setattr(process_job, "validate_public_url", stop)
    monkeypatch.setattr(process_job, "run_pipeline", _never)
    store = FakeStore()
    job = Job(
        id=JOB, user_id="u", source_url="https://youtu.be/abc", clips_requested=1,
        segments=[{"start": 10, "end": 40}],
    )
    process_job.process(store, job)
    assert reached == ["https://youtu.be/abc"]
    assert store.failed and store.failed[0] != "Pick at least one moment to clip."
