"""Provider `opencmo-motion`: narrated explainers (docs/explainer-build.md, Track B).

No third party draws the picture: the Assistant's Remotion scene code renders in headless
Chromium through the `clip-motion` CLI. The voice is generated first (ElevenLabs on fal, premade
voices only) because its word timings drive every beat and cue; the CLI muxes it into the MP4,
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

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

from opencmo.ai.catalog import AiModel, get_model, narration
from opencmo.ai.providers.base import Poll, ProviderAdapter, ProviderError, Result
from opencmo.media.ffmpeg import USER_INPUT, run

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
    job: dict[str, Any] = {
        "title": str(scene["title"]).strip(),
        "code": spec["code"],
        "beats": [
            {"say": str(beat["say"]).strip(), **({"label": str(beat["label"]).strip()} if beat.get("label") else {})}
            for beat in scene["beats"]
        ],
        "format": spec["aspectRatio"],
        "duration": int(spec["duration"]),
        "seed": int(spec.get("seed") or 0),
    }
    for key in ("accent", "theme", "personality"):
        if scene.get(key):
            job[key] = scene[key]
    if words:
        job["words"] = words
    return job


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
    if voice is None:
        from opencmo.ai.providers.fal import FalProvider

        key = os.environ.get("FAL_KEY", "")
        if not key:
            raise ProviderError("Generation is not set up on the server yet. Your credits were refunded.")
        voice = FalProvider(key)
    voice_dir = workdir / "voice"
    voice_dir.mkdir(exist_ok=True)
    result = voice.run(get_model(VOICE_MODEL), {"prompt": text, "voice": spec["voice"]}, voice_dir)
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


def preview_local(job: dict[str, Any], workdir: Path) -> dict[str, Any]:
    """`clip-motion preview` → PreviewResult plus `images` (base64 JPEGs, same order as `stills`).

    The Modal endpoint `motion_preview` serves this; the web app's local path spawns the CLI itself.
    """
    import base64

    job_file = workdir / "job.json"
    job_file.write_text(json.dumps(job), encoding="utf-8")
    outdir = workdir / "stills"
    outdir.mkdir(exist_ok=True)
    try:
        proc = subprocess.run(
            ["node", str(CLIP_MOTION), "preview", str(job_file), str(outdir)],
            capture_output=True, text=True, timeout=55, env=cli_env(), check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "phase": "render", "message": "The preview took too long. Simplify the scene."}
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
        raise RuntimeError("The explainer preview failed.")
    if result.get("ok"):
        images = []
        for still in result.get("stills") or []:
            path = Path(str(still["file"]))
            path = path if path.is_absolute() else outdir / path
            # Only files the CLI wrote into this preview's folder.
            if outdir.resolve() not in path.resolve().parents:
                raise RuntimeError("The explainer preview failed.")
            images.append(base64.b64encode(path.read_bytes()).decode())
            still["file"] = path.name
        result["images"] = images
    return result


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
        audio, self._words = make_voice(spec, workdir, self._voice)
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
        audio, self._words = make_voice(spec, workdir, self._voice)
        payload = {"job": motion_job(spec, self._words), "audio": audio.read_bytes()}
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
