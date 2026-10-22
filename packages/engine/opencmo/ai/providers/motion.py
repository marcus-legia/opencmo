"""Provider `opencmo-motion`: narrated explainers (docs/explainer-build.md, Track B).

No third party draws the picture: the Assistant's Remotion scene code renders in headless
Chromium through the `clip-motion` CLI. The voice is generated first (ElevenLabs, premade voices
only, through whatever provider the `elevenlabs-voice` catalog row names) because its word timings drive every beat and cue; the CLI muxes it into the MP4,
so the explainer is one layer and nothing can drift.

Two places to render, like 3D Studio:

- `OPENCMO_MOTION=modal`: the worker makes the voice, then spawns `render_motion` on Modal (a CPU
  container with Chromium and no secrets) and polls it; the render does not count against the
  worker's 2 GB budget.
- `OPENCMO_MOTION=local`: the CLI runs on this machine (dev).

`OPENCMO_MOTION_FAKE_VOICE=1` replaces the voice with a silent track and leaves `words` out, so
the renderer times the beats from its own estimate: the whole flow runs without paid keys.

A broken job (exit 3) or broken scene code (exit 4) is never retried: running it again gives the
same refusal and would charge for the voice again.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import select
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from opencmo.ai.catalog import AiModel, SpecError, get_model, narration
from opencmo.ai.providers.base import Poll, ProviderAdapter, ProviderError, Result
from opencmo.media.ffmpeg import USER_INPUT, FFmpegError, reencode_image, run

log = logging.getLogger(__name__)

_REPO = Path(__file__).resolve().parents[5]
CLIP_MOTION = Path(os.environ.get("OPENCMO_CLIP_MOTION", _REPO / "packages/clip-motion/src/cli.ts"))

INVALID = "This explainer is not valid. Your credits were refunded."
FAILED = "The explainer render failed. Your credits were refunded."
BUSY = "The explainer renderer is busy. We will try again shortly."
#: Exit code 4: the Assistant's code failed. The JS engine's sentence goes with it so the
#: Assistant knows what to fix.
CODE_FAILED = "The explainer code failed"

#: The voice model the narration is read with: same catalog row as voiceovers.
VOICE_MODEL = "elevenlabs-voice"

#: A 90 s explainer at 1080p renders in a few minutes on 4 CPUs; dev machines can take longer.
RENDER_TIMEOUT = int(os.environ.get("OPENCMO_MOTION_TIMEOUT", "1500"))
#: A 90 s 1080p H.264 is well under this; much larger means something went wrong.
MAX_BYTES = 300 * 1024 * 1024

MODAL_APP = "opencmo"
MODAL_FUNCTION = "render_motion"


def code_failed(detail: str) -> str:
    detail = " ".join(detail.split())[:200].rstrip(".") or "unknown error"
    return f"{CODE_FAILED}: {detail}. Your credits were refunded."


def fake_voice() -> bool:
    return os.environ.get("OPENCMO_MOTION_FAKE_VOICE") == "1" and os.environ.get("OPENCMO_ENV") != "production"


def motion_job(spec: dict[str, Any], words: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The `MotionJob` the CLI reads (packages/clip-motion/src/job.ts) from a generation spec.

    `code` is attached by the worker after loading it by `scene.code_ref`.
    """
    scene = spec["scene"]
    clip = scene.get("template") == "clip"
    job: dict[str, Any] = {
        # A silent clip times its beats by their own seconds; an explainer by the voice.
        **({"kind": "clip"} if clip else {}),
        "title": str(scene["title"]).strip(),
        "code": spec["code"],
        "beats": [
            {
                "say": str(beat["say"]).strip(),
                **({"label": str(beat["label"]).strip()} if beat.get("label") else {}),
                **({"seconds": beat["seconds"]} if clip else {}),
            }
            for beat in scene["beats"]
        ],
        "format": spec["aspectRatio"],
        "duration": int(spec["duration"]),
        "seed": int(spec.get("seed") or 0),
    }
    for key in ("accent", "theme", "personality"):
        if scene.get(key):
            job[key] = scene[key]
    if spec.get("motionAssets"):
        # Inlined by the worker (`motion_assets`) before the render: the CLI never fetches them.
        job["assets"] = spec["motionAssets"]
    if words and not clip:
        job["words"] = words
    return job


def is_clip(spec: dict[str, Any]) -> bool:
    """A silent motion clip (`motion-clip`): no voice is made and the MP4 has no audio stream."""
    return (spec.get("scene") or {}).get("template") == "clip"


#: Same rules as `ASSET_NAME`, `MAX_ASSETS` and `MAX_ASSET_BYTES` in packages/clip-motion/src/job.ts.
ASSET_NAME = re.compile(r"[a-z][a-z0-9-]{0,31}")
MAX_ASSETS = 6
ASSET_MAX_BYTES = 2_000_000
#: A 1080p frame never needs more; smaller edges are tried when the file is still too big.
ASSET_EDGES = (2048, 1536, 1024, 768)
#: What a library image may weigh before it is re-encoded (same as generation inputs).
ASSET_SOURCE_MAX_BYTES = 30 * 1024 * 1024
ASSET_NOT_FOUND = "An image in this animation is not in your library. Pick it again."
ASSET_UNREADABLE = "An image in this animation could not be read. Pick another one."


def _own_media(ref: Any, user_id: str) -> bool:
    """Same rule as `public.ai_media_ref_ok`, against the task's owner instead of the caller."""
    return (
        isinstance(ref, str)
        and len(ref) <= 500
        and ref.startswith(f"{user_id}/")
        and ".." not in ref
        and "\\" not in ref
    )


def _png_info(data: bytes) -> tuple[int, int, bool]:
    """Width, height and whether a PNG we wrote ourselves can be transparent (IHDR colour type, tRNS)."""
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("not a PNG")
    width, height = int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    color = data[25]
    return width, height, color in (4, 6) or b"tRNS" in data


def _encode_asset(raw: Path, workdir: Path, stem: str) -> dict[str, Any]:
    """`{src, width, height}`: PNG when the image can be transparent (logos keep their alpha), JPEG
    otherwise, the longest edge at most 2048 px and the file under the 2 MB the renderer takes."""
    for edge in ASSET_EDGES:
        png = reencode_image(raw, workdir / f"{stem}-{edge}.png", edge)
        data = png.read_bytes()
        width, height, alpha = _png_info(data)
        kind = "png"
        if not alpha:
            # Our own PNG now, still read through image2pipe like any image.
            data = reencode_image(png, workdir / f"{stem}-{edge}.jpg", edge, extra=["-q:v", "3"]).read_bytes()
            kind = "jpeg"
        if len(data) <= ASSET_MAX_BYTES:
            return {"src": f"data:image/{kind};base64,{base64.b64encode(data).decode()}", "width": width, "height": height}
    raise SpecError(ASSET_UNREADABLE)


def motion_assets(store: Any, task: Any, scene: dict[str, Any], workdir: Path) -> list[dict[str, Any]]:
    """The scene's images as the job's `assets`: `[{name, src: data URI, width, height}]`.

    SQL checked each `ref` against the caller when the generation was created; this checks it again
    against the task's OWNER, so an edited generation row cannot show another user's image.
    """
    items = scene.get("assets") or []
    if not isinstance(items, list) or len(items) > MAX_ASSETS:
        raise SpecError(ASSET_NOT_FOUND)
    out: list[dict[str, Any]] = []
    names: set[str] = set()
    for index, item in enumerate(items):
        name = item.get("name") if isinstance(item, dict) else None
        ref = item.get("ref") if isinstance(item, dict) else None
        if not isinstance(name, str) or not ASSET_NAME.fullmatch(name) or name in names or not _own_media(ref, task.user_id):
            raise SpecError(ASSET_NOT_FOUND)
        names.add(name)
        raw = workdir / f"asset-{index}"
        try:
            store.download_object("media", ref, raw, max_bytes=ASSET_SOURCE_MAX_BYTES)
        except Exception as exc:
            raise SpecError(ASSET_NOT_FOUND) from exc
        try:
            encoded = _encode_asset(raw, workdir, f"asset-{index}")
        except (FFmpegError, ValueError, OSError) as exc:
            raise SpecError(ASSET_UNREADABLE) from exc
        out.append({"name": name, **encoded})
    return out


def _fit_words(words: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    """Words that start inside the video, ends clamped to it (the audio is cut at `duration`)."""
    fitted = []
    for word in words:
        start = float(word["start"])
        if start >= duration:
            break
        end = min(max(float(word["end"]), start), duration)
        fitted.append({"text": str(word["text"]), "start": round(start, 3), "end": round(end, 3)})
    return fitted


def _silence(seconds: int, out: Path) -> Path:
    run([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", str(seconds), "-c:a", "aac", "-b:a", "64k", str(out),
    ], timeout=60)
    return out


def _cut(audio: Path, seconds: int, out: Path) -> Path:
    # The voice came back from a provider: read it like an upload (engine rule 7).
    run(["ffmpeg", "-v", "error", "-y", *USER_INPUT, "-i", str(audio), "-t", str(seconds), "-c:a", "copy", str(out)], timeout=120)
    return out


def make_voice(spec: dict[str, Any], workdir: Path, voice: ProviderAdapter | None = None) -> tuple[Path, list[dict[str, Any]] | None]:
    """The narration as an audio file plus its word timings (None = the renderer estimates)."""
    duration = int(spec["duration"])
    if fake_voice():
        return _silence(duration, workdir / "voice.m4a"), None
    text = narration(spec["scene"])
    model = get_model(VOICE_MODEL)
    if voice is None:
        # Same adapter as a voiceover: the catalog row decides the provider, so narration and
        # voiceovers can never drift onto different keys.
        from opencmo.ai.catalog import SpecError
        from opencmo.ai.providers import adapter_for

        try:
            voice = adapter_for(model)
        except SpecError as exc:
            raise ProviderError(str(exc)) from exc
    voice_dir = workdir / "voice"
    voice_dir.mkdir(exist_ok=True)
    result = voice.run(model, {"prompt": text, "voice": spec["voice"]}, voice_dir)
    if result is None:
        raise ProviderError(FAILED)
    words = result.words or []
    if words and float(words[-1]["end"]) > duration:
        # The script reads longer than the paid duration: keep the video length, cut the voice.
        log.warning("explainer narration %.1f s > %d s: cutting the voice", float(words[-1]["end"]), duration)
        return _cut(result.path, duration, workdir / "voice-cut.m4a"), _fit_words(words, duration) or None
    return result.path, words or None


#: Render concurrency cap: `render_motion` and `motion_preview` run with cpu=4.
MAX_CONCURRENCY = 4


def cli_env() -> dict[str, str]:
    """Only what the CLI reads: the worker's keys stay out of a process that runs the Assistant's code."""
    keep = ("PATH", "HOME", "TMPDIR", "LANG", "OPENCMO_EDITOR_FONTS")
    env = {k: v for k, v in os.environ.items() if k in keep or k.startswith("OPENCMO_MOTION_")}
    # Remotion refuses a concurrency above the machine's core count (`os.cpus()`, which is what
    # `os.cpu_count()` reads), so a fixed number fails on a smaller container.
    env.setdefault("OPENCMO_MOTION_CONCURRENCY", str(min(os.cpu_count() or 1, MAX_CONCURRENCY)))
    return env


def render_local(job: dict[str, Any], audio: Path | None, workdir: Path) -> Path:
    """Runs `clip-motion render`; returns the MP4. Raises ProviderError in English."""
    job_file = workdir / "job.json"
    job_file.write_text(json.dumps(job), encoding="utf-8")
    out = workdir / "explainer.mp4"
    args = ["node", str(CLIP_MOTION), "render", str(job_file), str(out)]
    if audio is not None:
        args += ["--audio", str(audio)]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=RENDER_TIMEOUT, env=cli_env(), check=False)
    except subprocess.TimeoutExpired as exc:
        raise ProviderError(FAILED) from exc
    if proc.returncode == 4:
        lines = proc.stderr.strip().splitlines()
        log.warning("explainer code failed: %s", proc.stderr.strip()[-400:])
        raise ProviderError(code_failed(lines[-1] if lines else ""))
    if proc.returncode == 3:
        log.warning("clip-motion rejected the job: %s", proc.stderr.strip()[-400:])
        raise ProviderError(INVALID)
    if proc.returncode != 0 or not out.exists() or out.stat().st_size == 0:
        log.error("clip-motion failed (code %s): %s", proc.returncode, proc.stderr.strip()[-1500:])
        raise ProviderError(FAILED)
    # stdout: {"frames", "seconds", "msPerFrame"} — kept in the log to compare machines.
    log.info("clip-motion: %s", proc.stdout.strip()[-300:])
    return out


def render_bytes(payload: dict[str, Any], workdir: Path) -> bytes:
    """What `render_motion` on Modal runs: `{job, audio?}` → MP4 bytes."""
    audio = None
    if payload.get("audio"):
        audio = workdir / "voice.m4a"
        audio.write_bytes(payload["audio"])
    return render_local(payload["job"], audio, workdir).read_bytes()


PREVIEW_TIMEOUT = 55
PREVIEW_TOO_LONG = {"ok": False, "phase": "render", "message": "The preview took too long. Simplify the scene."}
PREVIEW_FAILED = "The explainer preview failed."


def _with_images(result: dict[str, Any], outdir: Path) -> dict[str, Any]:
    """Adds `images` (base64 JPEGs, same order as `stills`) to an ok PreviewResult."""
    import base64

    if result.get("ok"):
        images = []
        for still in result.get("stills") or []:
            path = Path(str(still["file"]))
            path = path if path.is_absolute() else outdir / path
            # Only files the CLI wrote into this preview's folder.
            if outdir.resolve() not in path.resolve().parents:
                raise RuntimeError(PREVIEW_FAILED)
            images.append(base64.b64encode(path.read_bytes()).decode())
            still["file"] = path.name
        result["images"] = images
    return result


def preview_local(job: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """`clip-motion preview` → PreviewResult plus `images`: one process (and one Chromium) per preview.

    `PreviewSession` is the warm path used by the Modal endpoint; the web app's local path spawns
    the CLI itself.
    """
    job_file = workdir / "job.json"
    job_file.write_text(json.dumps(job), encoding="utf-8")
    outdir = workdir / "stills"
    outdir.mkdir(exist_ok=True)
    try:
        proc = subprocess.run(
            ["node", str(CLIP_MOTION), "preview", str(job_file), str(outdir)],
            capture_output=True, text=True, timeout=PREVIEW_TIMEOUT, env=cli_env(), check=False,
        )
    except subprocess.TimeoutExpired:
        return dict(PREVIEW_TOO_LONG)
    try:
        result = json.loads(proc.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        result = None
    if not isinstance(result, dict) or "ok" not in result:
        lines = proc.stderr.strip().splitlines()
        if proc.returncode in (3, 4):
            phase = "job" if proc.returncode == 3 else "render"
            return {"ok": False, "phase": phase, "message": (lines[-1] if lines else "")[:500] or "The scene failed."}
        log.error("clip-motion preview failed (code %s): %s", proc.returncode, proc.stderr.strip()[-1500:])
        raise RuntimeError(PREVIEW_FAILED)
    return _with_images(result, outdir)


class PreviewSession:
    """One `clip-motion serve` process per container, so Chromium and the bundle open once and every
    preview after the first skips that start-up.

    Protocol (one JSON line each way): the CLI prints `{"ready": true}` once the browser is open,
    then answers each `{"job", "outdir"}` with a PreviewResult. A crash or a preview past the
    timeout kills the process; the next preview starts a new one. One preview at a time.
    """

    def __init__(self, command: list[str] | None = None, timeout: float = PREVIEW_TIMEOUT) -> None:
        self._command = command or ["node", str(CLIP_MOTION), "serve"]
        self._timeout = timeout
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    def start(self) -> float:
        """Opens the process if it is not running; returns the seconds it took (0 when warm)."""
        with self._lock:
            return self._start()

    def close(self) -> None:
        with self._lock:
            self._kill()

    def preview(self, job: dict[str, Any], workdir: Path) -> dict[str, Any]:
        outdir = workdir / "stills"
        outdir.mkdir(exist_ok=True)
        with self._lock:
            self._start()
            assert self._proc is not None and self._proc.stdin is not None
            try:
                self._proc.stdin.write(json.dumps({"job": job, "outdir": str(outdir)}) + "\n")
                self._proc.stdin.flush()
            except OSError as exc:
                self._kill()
                raise RuntimeError(PREVIEW_FAILED) from exc
            line = self._read_line()
            if line is None:
                return dict(PREVIEW_TOO_LONG)
        try:
            result = json.loads(line)
        except ValueError:
            result = None
        if not isinstance(result, dict) or "ok" not in result:
            log.error("clip-motion serve answered %r", line[:300])
            self.close()
            raise RuntimeError(PREVIEW_FAILED)
        return _with_images(result, outdir)

    def _start(self) -> float:
        if self._proc is not None and self._proc.poll() is None:
            return 0.0
        began = time.monotonic()
        # stderr goes to the container's log: Remotion's progress and the scene's console.
        self._proc = subprocess.Popen(
            self._command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=cli_env(), bufsize=1,
        )
        line = self._read_line()
        try:
            ready = json.loads(line) == {"ready": True} if line is not None else False
        except ValueError:
            ready = False
        if not ready:
            log.error("clip-motion serve did not start: %r", (line or "")[:300])
            self._kill()
            raise RuntimeError(PREVIEW_FAILED)
        seconds = time.monotonic() - began
        log.info("clip-motion serve ready in %.1f s", seconds)
        return seconds

    def _read_line(self) -> str | None:
        """The next stdout line; None after a timeout (the process is killed). A dead process raises."""
        assert self._proc is not None and self._proc.stdout is not None
        ready, _, _ = select.select([self._proc.stdout], [], [], self._timeout)
        if not ready:
            log.warning("clip-motion serve timed out after %.0f s", self._timeout)
            self._kill()
            return None
        line = self._proc.stdout.readline()
        if not line:
            code = self._proc.wait()
            log.error("clip-motion serve exited (code %s)", code)
            self._proc = None
            raise RuntimeError(PREVIEW_FAILED)
        return line.strip()

    def _kill(self) -> None:
        if self._proc is not None:
            self._proc.kill()
            self._proc.wait()
            self._proc = None


def _result(path: Path, words: list[dict[str, Any]] | None) -> Result:
    # The words go back with the video so the editor can add captions (`complete_generation`).
    return Result(path=path, content_type="video/mp4", extension="mp4", words=words)


class MotionLocalProvider(ProviderAdapter):
    poll_seconds = 0.0
    timeout_seconds = float(RENDER_TIMEOUT)

    def __init__(self, voice: ProviderAdapter | None = None) -> None:
        self._voice = voice
        self._words: list[dict[str, Any]] | None = None

    def submit(self, model: AiModel, spec: dict[str, Any], workdir: Path) -> str:
        audio, self._words = (None, None) if is_clip(spec) else make_voice(spec, workdir, self._voice)
        return str(render_local(motion_job(spec, self._words), audio, workdir))

    def poll(self, ref: str) -> Poll:
        return Poll("done")

    def fetch(self, ref: str, dest_dir: Path) -> Result:
        return _result(Path(ref), self._words)


class MotionModalProvider(ProviderAdapter):
    """Voice here, then spawn `render_motion` on Modal, poll by call id, write the bytes."""

    poll_seconds = 3.0
    timeout_seconds = 900.0

    def __init__(self, functions: Any = None, voice: ProviderAdapter | None = None) -> None:
        # `functions` lets tests replace Modal; the real SDK by default.
        if functions is None:
            import modal

            functions = modal
        self._modal = functions
        self._voice = voice
        self._workdir: Path | None = None
        self._done: dict[str, Path] = {}
        self._words: list[dict[str, Any]] | None = None

    def submit(self, model: AiModel, spec: dict[str, Any], workdir: Path) -> str:
        self._workdir = workdir
        audio, self._words = (None, None) if is_clip(spec) else make_voice(spec, workdir, self._voice)
        payload = {"job": motion_job(spec, self._words), **({"audio": audio.read_bytes()} if audio is not None else {})}
        try:
            function = self._modal.Function.from_name(MODAL_APP, MODAL_FUNCTION)
            call = function.spawn(payload)
        except Exception as exc:
            # Modal is briefly unreachable: retry the task. The user's credits stay held once;
            # only the voice is made again, at our cost.
            log.warning("Could not spawn %s: %s", MODAL_FUNCTION, exc)
            raise ProviderError(BUSY, retryable=True) from exc
        return str(call.object_id)

    def poll(self, ref: str) -> Poll:
        if ref in self._done:
            return Poll("done")
        call = self._modal.FunctionCall.from_id(ref)
        try:
            data = call.get(timeout=0)
        except TimeoutError:
            return Poll("running")
        except Exception as exc:  # noqa: BLE001 — every error of the remote function lands here
            # ProviderError pickles through Modal with its message; anything else is a failure.
            text = str(exc)
            message = text if text in (INVALID, FAILED) or text.startswith(f"{CODE_FAILED}: ") else FAILED
            return Poll("failed", message)
        if not isinstance(data, (bytes, bytearray)) or not data or len(data) > MAX_BYTES:
            return Poll("failed", FAILED)
        assert self._workdir is not None
        path = self._workdir / "explainer.mp4"
        path.write_bytes(data)
        self._done[ref] = path
        return Poll("done")

    def fetch(self, ref: str, dest_dir: Path) -> Result:
        return _result(self._done[ref], self._words)
