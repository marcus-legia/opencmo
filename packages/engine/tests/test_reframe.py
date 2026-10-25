"""Face tracking on upload: the crop window keeps the speaker on screen.

Most cases rebuild real symptoms of the old clip pipeline (a clip that only showed a shoulder, or the background).
None of them needs MediaPipe: they check the maths after the face positions are known, and the tile extraction with
real ffmpeg.
"""

from __future__ import annotations

import statistics
import subprocess
from pathlib import Path

import pytest

from opencmo.steps import reframe
from opencmo.steps.reframe import (
    MAX_KEYFRAMES,
    Face,
    Tile,
    _choose_center,
    _merge,
    confident,
    crop_window,
    editor_focus,
    face_track,
    focus_points,
    tiles_for,
)

W169 = crop_window(16 / 9)
#: A typical close-up face box, measured on real runs: about 10% of the source width.
FACE_W = 0.10


def _faces(xs: list[float], w: float = FACE_W) -> list[Face]:
    return [Face(frame=i, x=x, w=w, area=w * w) for i, x in enumerate(xs)]


def _kept(faces: list[Face], center: float) -> int:
    half = W169 / 2
    clamped = min(1.0 - half, max(half, center))
    return len({f.frame for f in faces if reframe._inside(f, clamped, W169)})


def _track(xs: list[float], fps: float = 2.0, w: float = 0.09) -> list[tuple[float, Face]]:
    return [(i / fps, Face(frame=i, x=x, w=w, area=w * w)) for i, x in enumerate(xs)]


def test_the_916_window_is_a_third_of_a_169_source():
    assert round(W169, 3) == 0.316
    assert round(crop_window(4 / 3), 3) == 0.422
    assert crop_window(9 / 16) == 1.0


def test_a_talking_head_keeps_the_median():
    xs = [0.70, 0.72, 0.71, 0.73, 0.72]
    assert _choose_center(_faces(xs), W169) == statistics.median(xs)


def test_two_people_interview_never_lands_on_the_empty_middle():
    faces = _faces([0.30 if i % 2 else 0.70 for i in range(100)])
    assert _kept(faces, statistics.median([f.x for f in faces])) == 0
    center = _choose_center(faces, W169)
    assert _kept(faces, center) == 50
    assert abs(center - 0.30) < 0.01 or abs(center - 0.70) < 0.01


def test_a_close_up_beats_scattered_small_faces_of_a_wide_shot():
    faces = [Face(frame=i, x=0.80, w=0.12, area=0.05) for i in range(40)]
    for i in range(40, 100):
        faces += [Face(frame=i, x=x, w=0.03, area=0.002) for x in (0.1, 0.3, 0.5)]
    assert abs(_choose_center(faces, W169) - 0.80) < 0.01


def test_a_crowded_frame_counts_once():
    crowd = [Face(frame=0, x=0.2 + 0.01 * i, w=0.03, area=0.004) for i in range(20)]
    speaker = [Face(frame=i, x=0.85, w=0.10, area=0.02) for i in range(1, 6)]
    assert abs(_choose_center(crowd + speaker, W169) - 0.85) < 0.02


def test_never_worse_than_the_median():
    cases = [
        [0.72] * 60 + [0.34] * 40,
        [0.72] * 50 + [0.34] * 50,
        [0.20] * 33 + [0.50] * 33 + [0.85] * 34,
        [0.25 + 0.60 * i / 99 for i in range(100)],
        [0.30 if i % 2 else 0.70 for i in range(100)],
        [0.80] * 40 + [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] * 10,
    ]
    for xs in cases:
        faces = _faces(xs)
        assert _kept(faces, _choose_center(faces, W169)) >= _kept(faces, statistics.median(xs)), xs[:3]


def test_the_chosen_band_keeps_its_middle_not_a_rounded_edge():
    # Regression: plain rounding put the band's upper end just outside the face's range (score 0) and the crop
    # centred on the band's lower edge, 0.165 for a face at 0.278.
    right = [Face(frame=i, x=0.864, w=0.085, area=0.013) for i in range(4)]
    left = [Face(frame=i, x=0.278, w=0.09, area=0.0143) for i in range(4, 9)]
    assert abs(_choose_center(right + left, W169) - 0.278) < 0.002


def test_weak_detections_next_to_a_sure_face_are_dropped():
    assert confident([("face", 0.9), ("shelf", 0.32)]) == [("face", 0.9)]
    assert confident([("small", 0.35), ("other", 0.31)]) == [("small", 0.35), ("other", 0.31)]


def test_tiles_are_squares_along_the_long_side_overlapping_by_half():
    wide = tiles_for(1920, 1080)
    assert len(wide) == 3
    assert wide[0] == Tile(0.0, 0.0, 0.5625, 1.0) and wide[-1].x == pytest.approx(0.4375)
    tall = tiles_for(1080, 1920)
    assert len(tall) == 3 and tall[0].w == 1.0 and tall[-1].y == pytest.approx(0.4375)
    assert tiles_for(1080, 1080) == [Tile(0.0, 0.0, 1.0, 1.0)]


def test_a_face_seen_by_two_overlapping_tiles_counts_once():
    a = Face(frame=0, x=0.50, w=0.08, area=0.01, y=0.4, h=0.14)
    b = Face(frame=0, x=0.505, w=0.08, area=0.01, y=0.41, h=0.14)
    far = Face(frame=0, x=0.80, w=0.08, area=0.01, y=0.4, h=0.14)
    assert _merge([(a, 0.8), (b, 0.95), (far, 0.9)]) == [(b, 0.95), (far, 0.9)]


def test_a_shot_change_cuts_on_the_frame_grid():
    track = _track([0.86] * 40 + [0.28] * 40)
    keys = focus_points(track, W169, 0.0, 39.5)
    assert keys[0] == [0.0, pytest.approx(0.842, abs=0.001)]
    assert [19.967, keys[0][1]] in keys and [20.0, 0.28] in keys
    assert keys[-1][1] == 0.28


def test_a_still_speaker_keeps_their_place_to_the_end():
    keys = focus_points(_track([0.75] * 60), W169, 0.0, 29.5)
    assert keys == [[0.0, 0.75], [29.5, 0.75]]


def test_the_whole_longest_upload_is_tracked():
    # 15 minutes, the speaker moves every 20 s: the old 40-key cap of clips stopped tracking after about 90 s.
    xs = [0.80 if (i // 40) % 2 == 0 else 0.25 for i in range(1800)]
    keys = focus_points(_track(xs), W169, 0.0, 899.5)
    assert keys[-1][0] >= 880 and len(keys) <= MAX_KEYFRAMES


def test_editor_focus_gives_the_frame_and_the_916_reframe_tracks():
    track = _track([0.80] * 20)
    focus = editor_focus(track, source_width=1920, source_height=1080, frame_aspect=16 / 9, duration=10.0)
    # A 16:9 frame on a 16:9 source does not slide (whole width), but the reframe track still follows the speaker.
    assert {value for _t, value in focus["frame"]} == {0.5}
    assert focus["reframe"] == [[0.0, 0.8], [10.0, 0.8]]
    assert editor_focus([], source_width=1920, source_height=1080, frame_aspect=9 / 16, duration=10.0) == {"frame": [], "reframe": []}


def test_tiles_come_from_real_ffmpeg_and_the_detector_sees_one_file_at_a_time(tmp_path: Path, monkeypatch):
    video = tmp_path / "talk.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "2", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    seen: list[tuple[int, int]] = []

    def detect(sequences, tiles, deadline=None):
        assert len(sequences) == len(tiles) == 3
        assert all(len(files) == len(sequences[0]) for files in sequences)
        # Square tiles, the short side scaled to TILE (never above the source).
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(sequences[2][0])],
            capture_output=True, text=True, check=True,
        )
        seen.append(tuple(int(v) for v in out.stdout.strip().split(",")))
        return [Face(frame=0, x=0.7, w=0.1, area=0.01)], len(sequences[0])

    monkeypatch.setattr(reframe, "_detect_faces", detect)
    track, covered = face_track(video, 2.0, width=640, height=360)
    assert seen == [(270, 270)]
    assert track == [(0.0, Face(frame=0, x=0.7, w=0.1, area=0.01))]
    assert covered == 2.0


def test_without_mediapipe_the_upload_is_framed_in_the_centre(monkeypatch, tmp_path: Path):
    import builtins

    real_import = builtins.__import__

    def no_mediapipe(name, *args, **kwargs):
        if name.startswith("mediapipe"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_mediapipe)
    frame = tmp_path / "t0_00001.jpg"
    frame.write_bytes(b"jpg")
    assert reframe._detect_faces([[frame]], [Tile(0, 0, 1, 1)]) == ([], 0)


def test_unreadable_media_gives_no_track(tmp_path: Path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    assert face_track(bad, 10.0, width=1920, height=1080) == ([], 0.0)


def test_focus_points_match_the_shared_golden():
    """The keys the web generator's check also reads (`tests/contracts/reframe/focus-points.json`); its `$comment`
    says how it was made and why it differs from the old TypeScript output."""
    import json

    golden = json.loads((Path(__file__).resolve().parents[3] / "tests" / "contracts" / "reframe" / "focus-points.json").read_text())
    for case in golden["cases"]:
        frames: dict[float, int] = {}
        track = [
            (t, Face(frame=frames.setdefault(t, len(frames)), x=x, w=min(1.0, area**0.5), area=area))
            for t, x, area in case["track"]
        ]
        got = focus_points(track, case["window"], case["source_in"], case["source_out"], case["offset"])
        assert got == case["expected"], case["name"]


def _size(image: Path) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(image)],
        capture_output=True, text=True, check=True,
    )
    return tuple(int(v) for v in out.stdout.strip().split(","))  # type: ignore[return-value]


def test_a_rotated_phone_video_is_tiled_upright(tmp_path: Path):
    from opencmo.media.probe import probe_file

    flat = tmp_path / "flat.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "1", "-pix_fmt", "yuv420p", str(flat)],
        check=True,
    )
    phone = tmp_path / "phone.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-display_rotation", "90", "-i", str(flat), "-c", "copy", str(phone)], check=True)
    info = probe_file(str(phone))
    # Stored 640x360 and shown portrait, the way a phone writes it.
    assert (info.width, info.height) == (360, 640)
    tiles = tiles_for(info.width, info.height)
    assert all(tile.w == 1.0 for tile in tiles)
    sequences, complete = reframe._extract_tiles(phone, tmp_path, 2.0, tiles, timeout=60)
    assert complete
    # Each tile is its own square of the upright frame: the top and the bottom differ.
    assert _size(sequences[0][0]) == (270, 270)
    assert sequences[0][0].read_bytes() != sequences[-1][0].read_bytes()


def test_a_near_square_frame_is_read_whole(tmp_path: Path):
    video = tmp_path / "wide-ish.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=594x540:rate=30", "-t", "1", "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    tiles = tiles_for(594, 540)
    assert tiles == [Tile(0.0, 0.0, 1.0, 1.0)]
    sequences, _complete = reframe._extract_tiles(video, tmp_path, 2.0, tiles, timeout=60)
    # The whole frame at 270 px high, not its left 540 px square.
    assert _size(sequences[0][0]) == (298, 270)


def test_a_pass_over_its_budget_tracks_the_start(tmp_path: Path, monkeypatch):
    def slow(args, **kwargs):
        for index in range(1, 6):
            for label in ("t0", "t1", "t2"):
                (tmp_path / f"{label}_{index:05d}.jpg").write_bytes(b"jpg")
        raise subprocess.TimeoutExpired(args, kwargs.get("timeout"))

    monkeypatch.setattr(reframe.subprocess, "run", slow)
    monkeypatch.setattr(reframe.tempfile, "TemporaryDirectory", lambda prefix: _Here(tmp_path))
    monkeypatch.setattr(reframe, "_detect_faces", lambda sequences, tiles, deadline=None: ([Face(frame=1, x=0.7, w=0.1, area=0.01)], len(sequences[0])))
    track, covered = face_track(tmp_path / "long.mp4", 900.0, width=1920, height=1080, budget=1)
    # Five frames written, the last maybe half: four kept, at 2 fps on a 15-minute video.
    assert covered == 2.0
    assert track == [(0.5, Face(frame=1, x=0.7, w=0.1, area=0.01))]
    focus = editor_focus(track, source_width=1920, source_height=1080, frame_aspect=9 / 16, duration=covered)
    assert focus["frame"][-1][0] <= covered


def test_a_decode_that_runs_over_still_leaves_time_to_detect(tmp_path: Path, monkeypatch):
    # Regression: decode and detection shared one deadline, so a decode stopped by its timeout handed detection a
    # deadline already past and the long upload got no track at all. The clock here only moves when decoding times
    # out, and the detector stops at the deadline as the real loop does.
    clock = [0.0]
    monkeypatch.setattr(reframe, "monotonic", lambda: clock[0])

    def slow(args, **kwargs):
        for index in range(1, 6):
            for label in ("t0", "t1", "t2"):
                (tmp_path / f"{label}_{index:05d}.jpg").write_bytes(b"jpg")
        clock[0] += kwargs["timeout"] + 0.5  # a killed decode stops just after its timeout
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    def detect(sequences, tiles, deadline=None):
        faces, done = [], 0
        for index in range(len(sequences[0])):
            if deadline is not None and reframe.monotonic() > deadline:
                break
            faces.append(Face(frame=index, x=0.7, w=0.1, area=0.01))
            done = index + 1
        return faces, done

    monkeypatch.setattr(reframe.subprocess, "run", slow)
    monkeypatch.setattr(reframe.tempfile, "TemporaryDirectory", lambda prefix: _Here(tmp_path))
    monkeypatch.setattr(reframe, "_detect_faces", detect)
    track, covered = face_track(tmp_path / "long.mp4", 900.0, width=1920, height=1080, budget=100)
    assert clock[0] == pytest.approx(100 * reframe.DECODE_SHARE + 0.5)
    assert covered == 2.0 and len(track) == 4


class _Here:
    def __init__(self, path: Path):
        self.path = path

    def __enter__(self) -> str:
        return str(self.path)

    def __exit__(self, *exc: object) -> None:
        return None


def test_a_source_as_narrow_as_the_frame_is_not_tracked():
    assert not reframe.needs_tracking(1080, 1920, 9 / 16)
    assert reframe.needs_tracking(1080, 1350, 9 / 16)
    assert reframe.needs_tracking(1920, 1080, 16 / 9)
    assert not reframe.needs_tracking(0, 0, 9 / 16)
