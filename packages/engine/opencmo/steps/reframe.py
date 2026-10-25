"""Face tracking for the editor: where the speaker is, over time, in the user's upload.

The editor frames a 16:9 upload as 9:16 (and reframes it to any other shape later) by sliding a crop window. Centred,
that window cuts a speaker who is not in the middle of the shot in half: measured on real talks, face centres ranged
from 0.37 to 0.87 of the width. So the worker measures the face once per upload and publishes two tracks in
`masters[clip].focus` (read by `apps/web/lib/editor/generate-project.ts`):

- `frame`: crop centres for the clip's own frame, which become the video's `x` keyframes;
- `reframe`: crop centres for a 9:16 window, stored in the scene's `reframe` mark so a later frame change still
  follows the speaker.

Brought back from the clip pipeline removed on 2026-10-20 (git 9acf1b0^:packages/engine/opencmo/steps/reframe.py),
keeping its measured decisions:

1. Sample a few frames per second, not every frame: a face does not move faster, and sparse samples are steadier.
2. Frames go to small JPEG tiles read one at a time: no video frame is held as an array (CLAUDE.md hard budget 1).
   Square tiles, because the short-range model squeezes its input to 128 px (new; see `TILE`).
3. MediaPipe's Tasks API (`mp.solutions` is gone from MediaPipe 1.0).
4. Choose the window that keeps the MOST face area, not the median: the median of two people sits on the empty
   space between them ("the clip only shows a shoulder").

MediaPipe is an optional extra (`[face]`). Without it, or when the detector cannot start, the upload is still
published, framed in the centre, and the log says why.
"""

from __future__ import annotations

import logging
import os
import statistics
import subprocess
import tempfile
import urllib.request
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from math import ceil, floor
from pathlib import Path
from time import monotonic
from typing import TypeVar

from ..media.ffmpeg import USER_INPUT

log = logging.getLogger(__name__)

# The Tasks API needs a model file; Modal bakes it into the image (`OPENCMO_FACE_MODEL`).
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
_MODEL_NAME = "blaze_face_short_range.tflite"

#: Samples per second for uploads up to this long; longer ones sample at half the rate.
DENSE_SECONDS = 600.0
DENSE_FPS = 4.0
SPARSE_FPS = 2.0
#: Detection runs on square tiles this many px: the short-range model squeezes its input into 128 px, so a whole 16:9
#: frame left a seated speaker's face a few pixels wide (0 detections on a test talk; 0.97 on tiles).
TILE = 270
#: Neighbouring tiles overlap by half, so a face on a seam is whole in one of them.
TILE_OVERLAP = 0.5
#: The worker container's CPUs (`run_job` in modal_app.py): ffmpeg's decoder threads stay within it.
THREADS = 4
#: Wall time for the whole pass (decode + detection). The upload job has 1800 s in all (`run_job`), and decoding is
#: the cost: 0.27 s per second of 4K H.264 and 0.49 s per second of 4K HEVC on 4 CPUs (measured 2026-10-25), so a
#: 15-minute 4K phone video can take 7-15 minutes. Past the budget the track stops where it got to, and the editor
#: holds the last centre for the rest: the upload still has time to be transcribed and published.
BUDGET_SECONDS = 420


def _cache_dir() -> Path:
    root = os.getenv("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(root) / "opencmo"


def face_model_path() -> Path:
    """The model file: `OPENCMO_FACE_MODEL` when set (the worker image), else downloaded once to the cache."""
    override = os.getenv("OPENCMO_FACE_MODEL")
    if override:
        return Path(override)
    target = _cache_dir() / _MODEL_NAME
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    # A unique temp name: two jobs downloading at once must not rename each other's half file.
    fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=".model-", suffix=".part")
    tmp = Path(tmp_name)
    try:
        # The URL is a constant of this file, never user input.
        with urllib.request.urlopen(_MODEL_URL, timeout=60) as resp, os.fdopen(fd, "wb") as fh:
            fh.write(resp.read())
        tmp.replace(target)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return target


@dataclass(frozen=True)
class Face:
    """One detection, as fractions of the frame. `w` matters: a face whose centre is inside the window can still be
    half cut by its edge; `y` and `h` place the head for seats (plan O8)."""

    frame: int
    x: float
    w: float
    area: float
    y: float = 0.5
    h: float = 0.0


#: A face track: one `(source second, Face)` per detection, in time order (a frame with two people gives two).
Track = list[tuple[float, Face]]


def sample_fps(duration: float) -> float:
    return DENSE_FPS if duration <= DENSE_SECONDS else SPARSE_FPS


@dataclass(frozen=True)
class Tile:
    """A square window of each sampled frame, as fractions of the frame."""

    x: float
    y: float
    w: float
    h: float


def tiles_for(width: int, height: int) -> list[Tile]:
    """Square tiles along the long side, overlapping by half; one tile, the whole frame, for a near-square frame."""
    if width <= 0 or height <= 0:
        return [Tile(0.0, 0.0, 1.0, 1.0)]
    long_side, short_side = max(width, height), min(width, height)
    if long_side <= short_side * 1.15:
        return [Tile(0.0, 0.0, 1.0, 1.0)]
    span = long_side - short_side
    count = ceil(span / (short_side * (1 - TILE_OVERLAP))) + 1
    share = short_side / long_side
    offsets = [span * i / (count - 1) / long_side for i in range(count)]
    if width >= height:
        return [Tile(offset, 0.0, share, 1.0) for offset in offsets]
    return [Tile(0.0, offset, 1.0, share) for offset in offsets]


def _extract_tiles(video: Path, workdir: Path, fps: float, tiles: list[Tile], timeout: float) -> tuple[list[list[Path]], bool]:
    """Small JPEG tiles of the video at `fps`, one image sequence per tile, read by the detector one file at a time.
    Past `timeout` the frames written so far are kept (the last one may be half written, so it goes), and the flag
    that says the sequences reach the end of the video is False.

    The master is our own remux, but its streams are still the user's: read through the demuxer allowlist. ffmpeg
    turns a rotated phone video upright, so `tiles` are for the displayed size (`probe_file` gives that).
    """
    # Short side to TILE px, never upscaled past the source.
    scale = f"scale='if(gte(iw,ih),-2,min({TILE},iw))':'if(gte(iw,ih),min({TILE},ih),-2)'"
    labels = [f"t{i}" for i in range(len(tiles))]
    # A whole-frame tile is the frame itself: a square crop of a near-square frame would miss its edge.
    crops = ";".join(
        f"[s{i}]null[{label}]"
        if tile.w >= 1.0 and tile.h >= 1.0
        else f"[s{i}]crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))*{_ratio(tile.x, tile.w)}':'(ih-min(iw,ih))*{_ratio(tile.y, tile.h)}'[{label}]"
        for i, (tile, label) in enumerate(zip(tiles, labels, strict=True))
    )
    graph = f"[0:v]fps={fps},{scale},split={len(tiles)}{''.join(f'[s{i}]' for i in range(len(tiles)))};{crops}"
    outputs: list[str] = []
    for label in labels:
        outputs += ["-map", f"[{label}]", "-q:v", "5", str(workdir / f"{label}_%05d.jpg")]
    args = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", str(THREADS),
        *USER_INPUT, "-i", str(video),
        "-filter_complex", graph, "-filter_complex_threads", str(THREADS),
        *outputs,
    ]
    partial = False
    try:
        if subprocess.run(args, capture_output=True, timeout=max(timeout, 1.0), check=False).returncode != 0:
            return [], False
    except subprocess.TimeoutExpired:
        partial = True
        log.warning("Face tracking: decoding passed its %.0f s budget; tracking the start only.", timeout)
    except (subprocess.SubprocessError, OSError):
        return [], False
    sequences = [sorted(workdir.glob(f"{label}_*.jpg")) for label in labels]
    if partial:
        frames = max(0, min((len(files) for files in sequences), default=0) - 1)
        sequences = [files[:frames] for files in sequences]
    return sequences, not partial


def _ratio(offset: float, size: float) -> str:
    """A tile's offset as a share of the room left beside it (0 = first edge, 1 = last), for ffmpeg's crop."""
    room = 1.0 - size
    return f"{(offset / room) if room > 1e-9 else 0.0:.6f}"


T = TypeVar("T")

#: A detection this sure is a face; next to one, a weak detection is noise.
SURE_FACE = 0.6
WEAK_FACE = 0.5


def confident(found: list[tuple[T, float]]) -> list[tuple[T, float]]:
    """Drops weak detections in a frame that already has a sure face.

    The low threshold keeps small faces in wide shots, but also lets dark bookshelves and lamps through at ~0.3, and
    their boxes can be bigger than the face (54-min interview, 2026-10-11: face 0.70-0.95, shelf 0.31-0.34, crop
    centred on the shelf).
    """
    if any(score >= SURE_FACE for _box, score in found):
        return [(box, score) for box, score in found if score >= WEAK_FACE]
    return found


def _merge(found: list[tuple[Face, float]]) -> list[tuple[Face, float]]:
    """One detection per face in a frame: overlapping tiles see a face near a seam twice."""
    kept: list[tuple[Face, float]] = []
    for face, score in sorted(found, key=lambda item: -item[1]):
        if any(abs(face.x - other.x) < max(face.w, other.w) / 2 and abs(face.y - other.y) < max(face.h, other.h) / 2 for other, _s in kept):
            continue
        kept.append((face, score))
    return kept


def _detect_faces(sequences: list[list[Path]], tiles: list[Tile], deadline: float | None = None) -> tuple[list[Face], int]:
    """Every face of every frame (not only the biggest: wide shots between close-ups made "the biggest" jump from one
    person to another), mapped from its tile back to the frame, and how many frames were read (fewer when `deadline`,
    a `monotonic()` value, passes). No faces when MediaPipe is missing or cannot start."""
    try:
        import mediapipe as mp  # type: ignore
        from mediapipe.tasks import python as mp_python  # type: ignore
        from mediapipe.tasks.python import vision  # type: ignore
    except ImportError:
        log.info("MediaPipe is not installed: framing in the centre. Install the engine's [face] extra.")
        return [], 0
    try:
        options = vision.FaceDetectorOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(face_model_path())),
            # Lower than the default: faces are small in wide stage shots. A stray hit cannot pull the crop, since
            # `_choose_center` scores summed face area.
            min_detection_confidence=0.3,
        )
        detector = vision.FaceDetector.create_from_options(options)
    except Exception as exc:  # noqa: BLE001 - a missing model or libEGL must not fail the upload
        # On Modal a missing libEGL/libGLES raised OSError here and killed whole jobs; the image installs both now.
        log.warning("Face detector unavailable (%s): framing in the centre.", exc)
        return [], 0

    faces: list[Face] = []
    frames = min((len(files) for files in sequences), default=0)
    done = 0
    try:
        for index in range(frames):
            if deadline is not None and monotonic() > deadline:
                log.warning("Face tracking: detection passed its budget at frame %d of %d; tracking the start only.", index, frames)
                break
            found: list[tuple[Face, float]] = []
            for tile, files in zip(tiles, sequences, strict=True):
                image = mp.Image.create_from_file(str(files[index]))
                result = detector.detect(image)
                for det in result.detections:
                    box = det.bounding_box
                    score = det.categories[0].score if det.categories else 1.0
                    w = box.width / image.width * tile.w
                    h = box.height / image.height * tile.h
                    found.append(
                        (
                            Face(
                                frame=index,
                                x=tile.x + (box.origin_x + box.width / 2) / image.width * tile.w,
                                w=w,
                                area=w * h,
                                y=tile.y + (box.origin_y + box.height / 2) / image.height * tile.h,
                                h=h,
                            ),
                            score,
                        )
                    )
            faces.extend(face for face, _score in confident(_merge(found)))
            done = index + 1
    finally:
        detector.close()
    return faces, done


def face_track(video: Path, duration: float, *, width: int, height: int, budget: float = BUDGET_SECONDS) -> tuple[Track, float]:
    """Face positions, `(source second, Face)` in time order, and the seconds of video they cover: all of it, or
    less when the pass ran out of its `budget` (wall seconds)."""
    fps = sample_fps(duration)
    tiles = tiles_for(width, height)
    deadline = monotonic() + budget
    with tempfile.TemporaryDirectory(prefix="opencmo-frames-") as tmp:
        sequences, complete = _extract_tiles(video, Path(tmp), fps, tiles, timeout=budget)
        if not sequences or not sequences[0]:
            return [], 0.0
        faces, frames = _detect_faces(sequences, tiles, deadline)
        total = len(sequences[0])
    covered = duration if complete and frames >= total else min(duration, frames / fps)
    log.info("Face track: %d detections in %d frames (%d tiles each) at %.0f fps, %.0f of %.0f s", len(faces), frames, len(tiles), fps, covered, duration)
    return [(face.frame / fps, face) for face in sorted(faces, key=lambda face: face.frame)], covered


def needs_tracking(width: int, height: int, frame_aspect: float) -> bool:
    """Whether any crop the editor makes slides: a source as narrow as the frame and as a 9:16 reframe has nothing to
    follow, and the pass would only cost decode time."""
    if width <= 0 or height <= 0:
        return False
    source = width / height
    return crop_window(source, frame_aspect) < 1.0 or crop_window(source, 9 / 16) < 1.0


# ---------------------------------------------------------------- choosing the window


def _valid_centres(face: Face, window: float) -> tuple[float, float]:
    """Crop centres for which the WHOLE face box is inside the window (empty when the face is wider than it)."""
    margin = (window - face.w) / 2
    return face.x - margin, face.x + margin


def _inside(face: Face, center: float, window: float) -> bool:
    lo, hi = _valid_centres(face, window)
    return lo <= center <= hi


def _score(faces: list[Face], center: float, window: float) -> float:
    """Face area kept on screen, one face per frame: a crowd of twenty heads must not outweigh twenty frames of the
    speaker."""
    per_frame: dict[int, float] = {}
    for face in faces:
        if _inside(face, center, window) and face.area > per_frame.get(face.frame, 0.0):
            per_frame[face.frame] = face.area
    return sum(per_frame.values())


def _choose_center(faces: list[Face], window: float) -> float:
    """The crop centre that keeps the most face area on screen.

    The median failed: two people at 0.30 and 0.70 give 0.50 and keep 0/100 frames. The score only changes at the
    ends of each face's valid range, so trying those ends covers every placement. Ties go to the band nearest the
    middle of the frame, and within a band to its middle (a margin on both sides).
    """
    xs = sorted(face.x for face in faces)
    # The common talking head: every face fits one window, and the median is the most balanced place.
    if xs[-1] - xs[0] <= window - max(face.w for face in faces):
        return statistics.median(xs)
    ends: set[float] = set()
    for face in faces:
        lo, hi = _valid_centres(face, window)
        # 0.001 ≈ 2 px on a 1080p source: finer is invisible and only multiplies candidates. Rounded INWARD: a plain
        # round could put an end just outside its face's range, score it zero and collapse the band to one edge
        # (a face at 0.278 got a crop centred at 0.165, its edge).
        ends.add(ceil(lo * 1000 - 1e-9) / 1000)
        ends.add(floor(hi * 1000 + 1e-9) / 1000)
    candidates = sorted(ends)
    scores = [_score(faces, c, window) for c in candidates]
    best = max(scores)
    if best <= 0:
        return statistics.median(xs)
    # Group the best candidates into contiguous bands: two people give two equal bands, and their joint middle is
    # the empty space again. Two neighbours in the list may still have a zero gap between them: ask the midpoint.
    bands: list[tuple[float, float]] = []
    for i, c in enumerate(candidates):
        if scores[i] != best:
            continue
        joined = bands and scores[i - 1] == best and _score(faces, (candidates[i - 1] + c) / 2, window) == best
        if joined:
            bands[-1] = (bands[-1][0], c)
        else:
            bands.append((c, c))
    lo, hi = min(bands, key=lambda band: abs((band[0] + band[1]) / 2 - 0.5))
    return (lo + hi) / 2


def crop_window(source_aspect: float, target_aspect: float = 9 / 16) -> float:
    """The crop window's width as a share of the source width: 0.316 for 9:16 on 16:9 (a face more than 0.158 off
    the centre is out), 0.422 on 4:3, the whole width when the source is already narrower."""
    if source_aspect <= target_aspect:
        return 1.0
    return target_aspect / source_aspect


def _faces_between(track: Track, start: float, end: float) -> list[Face]:
    lo = bisect_left(track, start, key=lambda sample: sample[0])
    hi = bisect_right(track, end, key=lambda sample: sample[0])
    return [face for _time, face in track[lo:hi]]


# ---------------------------------------------------------------- the editor's tracks

#: One key every this many seconds; longer clips stretch the step rather than drop the tail.
KEYFRAME_SECONDS = 2.0
#: Enough for the longest upload (15 min) at one key per 2 s plus its cuts. The old clip pipeline capped clips at 40,
#: which on a whole upload stopped the tracking after about 90 s. The editor keeps only the keys around each cut
#: piece (`editor-core/src/face-track.ts`), so the saved document stays small.
MAX_KEYFRAMES = 600
#: Centres closer than 1% of the source width merge: invisible, and the camera would twitch.
FOCUS_EPSILON = 0.01
#: The editor's frame grid; a shot change lands on it.
EDITOR_FPS = 30


def _js_round(value: float, digits: int) -> float:
    """JavaScript's `Math.round(v * 10^n) / 10^n` (half up), so key times match the documents the editor makes;
    Python's `round` rounds half to even."""
    scale = 10**digits
    return floor(value * scale + 0.5) / scale


def focus_at(track: Track, start: float, end: float, window: float) -> float:
    """The crop centre for `[start, end]` seconds, clamped so the window never leaves the frame."""
    faces = _faces_between(track, start, end)
    if not faces:
        return 0.5
    half = window / 2
    return min(max(_choose_center(faces, window), half), 1 - half)


def _cut_at(track: Track, previous: float, focus: float, start: float, end: float) -> float:
    """The second the face jumps from `previous` to `focus`: the first sample nearer `focus` after the last one
    still nearer `previous`. The end of the range when none is found."""
    samples = [(time, face.x) for time, face in track if start <= time <= end]
    last_old = -1
    for index, (_time, x) in enumerate(samples):
        if abs(x - previous) < abs(x - focus):
            last_old = index
    for time, x in samples[last_old + 1:]:
        if abs(x - focus) <= abs(x - previous):
            return time
    return end


def focus_points(track: Track, window: float, source_in: float, source_out: float, offset: float = 0.0) -> list[list[float]]:
    """`[master second, centre]` keys for the editor's `x` keyframes and `reframe` mark. `track` is in seconds of the
    original video and `offset` is where the master starts in it (0 for an upload's master).

    A shot change (the centre moves more than half a window) becomes TWO keys one frame apart on the editor's grid,
    so the camera cuts instead of panning across an empty background. A still speaker gives two equal keys.
    """
    span = source_out - source_in
    if span <= 0 or not track:
        return []
    step = max(KEYFRAME_SECONDS, span / MAX_KEYFRAMES)
    out: list[list[float]] = []
    previous: float | None = None
    steady = source_in
    at = source_in
    while at < source_out + 1e-6:
        time = min(at, source_out)
        at += step
        # The window straddles the key: the centre at `t` reflects the video around `t`, not what comes next.
        middle = offset + time
        focus = focus_at(track, middle - step / 2, middle + step / 2, window)
        if previous is not None and abs(focus - previous) < FOCUS_EPSILON:
            steady = time
            continue
        if previous is not None and abs(focus - previous) > window / 2 and len(out) + 2 <= MAX_KEYFRAMES:
            last = out[-1][0]
            cut = _cut_at(track, previous, focus, offset + steady - step / 2, middle + step / 2) - offset
            clamped = min(max(cut, last + 2 / EDITOR_FPS), time)
            snapped = source_in + _js_round((clamped - source_in) * EDITOR_FPS, 0) / EDITOR_FPS
            out.append([_js_round(snapped - 1 / EDITOR_FPS, 3), previous])
            out.append([_js_round(snapped, 3), focus])
            previous = focus
            steady = time
            continue
        previous = focus
        steady = time
        out.append([_js_round(time, 2), focus])
        if len(out) >= MAX_KEYFRAMES:
            break
    if len(out) == 1:
        # A speaker who never moves is still somewhere: one key held to the end, or the editor would centre the
        # crop and cut an off-centre speaker in half (the old pipeline passed this centre through the settings).
        out.append([_js_round(source_out, 2), out[0][1]])
    return out


ASPECTS = {"9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5, "16:9": 16 / 9}


def editor_focus(track: Track, *, source_width: int, source_height: int, frame_aspect: float, duration: float) -> dict[str, list[list[float]]]:
    """The two tracks the editor's project generator reads (`masters[clip].focus`).

    - `frame`: windows of the clip's own frame → the video's `x` keyframes;
    - `reframe`: windows the scene's `reframe` mark keeps for later frame changes. A frame that needs no sliding
      (16:9 on a 16:9 source) still samples a 9:16 window: the frame the user is almost sure to switch to.
    """
    if not track or source_width <= 0 or source_height <= 0 or duration <= 0:
        return {"frame": [], "reframe": []}
    source_out = _js_round(duration, 2)
    source_aspect = source_width / source_height
    reframe_target = frame_aspect if frame_aspect < source_aspect else 9 / 16
    return {
        "frame": focus_points(track, crop_window(source_aspect, frame_aspect), 0.0, source_out),
        "reframe": focus_points(track, crop_window(source_aspect, reframe_target), 0.0, source_out),
    }
