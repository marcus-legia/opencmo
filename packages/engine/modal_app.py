"""The OpenCMO worker on Modal.

Deploy:
    modal secret create opencmo \
        ANTHROPIC_API_KEY=... \
        SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
        OPENCMO_WORKER_TOKEN=...   # the same value as the web app's
        OPENCMO_WEB_URL=https://... CRON_SECRET=...   # AI CMO schedule; same CRON_SECRET as Vercel
        CRON_CLEANUP_SECRET=...   # cleanup only; same value as Vercel's CRON_CLEANUP_SECRET
        OPENCMO_WAKE_TOKEN=...    # `wake`; same value as the MCP server's OPENCMO_WAKE_TOKEN
    modal secret create opencmo-voice ELEVENLABS_API_KEY=...   # transcripts (Scribe); same key as Vercel
    modal secret create fal-secret FAL_KEY=...                  # media + output moderation; same key as Vercel
    modal secret create opencmo-motion MOTION_PREVIEW_TOKEN=... # explainer previews; same as Vercel, not the worker token
    modal deploy modal_app.py

Optional: add GEMINI_API_KEY to the `opencmo` secret. Gemini then checks AI output when Claude
cannot answer (no credit, an outage); without it such output is refunded, never delivered.

Deploy only after every migration is applied to the database: in the other order the worker calls RPCs that do
not exist yet and every job and task fails.

Why Modal rather than a VPS: no machine to manage, no OS updates, no systemd, no 2 a.m. pages. Billed by the
second, $0 when idle. The image is defined in Python, so there is no Dockerfile.

Ways in, on purpose:
  1. `submit` — an HTTP endpoint the web app calls when the user acts, then `run_job.spawn(...)`. No delay.
  2. `sweep()` — a cron every minute: the reconciler puts jobs whose lease ran out back in the queue, then picks
     up what is still queued. This is the safety net, not the main path.
     It also dispatches queued AI CMO runs to the web app (`_dispatch_cmo`).
  3. `cmo_schedule()` and `cleanup()` — daily crons that call the web app's cron routes.
     Modal is the only scheduler; `apps/web/vercel.json` has no crons.
  4. `wake` — the MCP server (`mcp_app.py`, its own app) asks for an early `sweep()` with a
     token that can do nothing else.

Because of (2), (1) may fail: the web app treats a failed `submit` as minor; the job stays 'queued' and runs a
minute later at most.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

import modal

APP_NAME = "opencmo"

# The most work one `sweep()` picks up, so an unusual burst (a loop bug on the web side, spam) cannot start hundreds
# of containers in a minute.
SWEEP_BATCH = 10

# `run_task` containers. Claims stop at this many running tasks (review R6): a task spawned past it waited in Modal's
# queue while its 120 s database lease ran out, was claimed again and failed after three tries without ever running.
RUN_TASK_MAX_CONTAINERS = 10


def _token_ok(expected: str, given: str) -> bool:
    """Constant-time token check on bytes: `hmac.compare_digest` on str raises for non-ASCII input (a 500, not 401)."""
    import hmac

    return bool(expected) and hmac.compare_digest(expected.encode("utf-8"), given.encode("utf-8"))

NODE_VERSION = "22.22.2"
WEB_ROOT = "/root/web"
_ENGINE = Path(__file__).parent
_PACKAGES = _ENGINE.parent
_NODE_IGNORE = ["node_modules", "node_modules/**", "**/*.test.ts"]

# The face model is baked into the upload worker's image: a cold container per job would otherwise download it each
# time, one more network failure point (opencmo/steps/reframe.py).
FACE_MODEL_REMOTE = "/root/models/blaze_face_short_range.tflite"
FACE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
)
# The clip fonts (R7c): one copy in packages/clip-media for every image.
MEDIA_ROOT = f"{WEB_ROOT}/packages/clip-media"
_MEDIA_ENV = {
    "OPENCMO_EDITOR_FONTS": f"{MEDIA_ROOT}/fonts",
}


def _with_node(img: modal.Image) -> modal.Image:
    # The exporter and clip-motion run .ts files directly with type stripping: Node ≥ 22.18,
    # bookworm's apt only has 18.
    return img.run_commands(
        f"curl -sSLf https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz"
        " | tar -xJ -C /usr/local --strip-components=1",
    )


def _with_engine(img: modal.Image, *, face: bool = False) -> modal.Image:
    # The engine is installed from this repo. Switch to `.pip_install("opencmo-engine")` if it is ever on PyPI.
    #
    # `ignore` is required: the engine folder on a dev machine holds .venv and test clips, several GB, which every
    # image build would upload otherwise. Anchored to this file, not the working directory: "." made
    # `modal deploy packages/engine/modal_app.py` from the repo root upload the whole repo, and pip said "Neither
    # 'setup.py' nor 'pyproject.toml' found".
    img = img.add_local_dir(
        _ENGINE,
        remote_path="/root/engine",
        copy=True,
        ignore=[
            ".venv*", "**/.venv*",
            "clips", "clips/**",
            "**/__pycache__", "**/*.pyc",
            ".pytest_cache", ".pytest_cache/**",
            ".ruff_cache", ".ruff_cache/**",
            "tests", "tests/**",
        ],
    )
    # The media model catalog lives in packages/contracts, OUTSIDE the engine folder: without it every `generate`
    # task fails (opencmo/ai/catalog.py). The task kinds table (opencmo/worker/kinds.py): without it the worker
    # cannot route any work.
    # The edit-length cap the web Upload panel shares (opencmo/worker/process_job.py).
    # Platform profiles Writer and the cards share (opencmo/platforms.py).
    for name in ("ai-models.json", "task-kinds.json", "upload-limits.json", "platforms.json"):
        img = img.add_local_file(
            _PACKAGES / "contracts" / name, remote_path=f"/root/contracts/{name}", copy=True
        )
    # The upload worker takes the [face] extra (MediaPipe) for face tracking; the other images never track faces.
    return img.run_commands(f"pip install '/root/engine{'[face]' if face else ''}'")


def _with_media(img: modal.Image) -> modal.Image:
    # The renderers draw text with exactly these font files.
    return img.add_local_dir(_PACKAGES / "clip-media", remote_path=MEDIA_ROOT, copy=True)


cpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    # `fonts-dejavu-core` is required, not cosmetic: captions (libass) and the watermark (drawtext) need a real font
    # file. debian_slim has none, and without one ffmpeg still runs and the clip just has no text: the silent
    # failure CLAUDE.md warns about.
    #
    # Noto: captions translated to Japanese/Korean/Chinese/Thai/Hindi and emoji would export as
    # boxes; the renderer names these families after the brand font (clip-render `applyFont`).
    #
    # `libegl1`/`libgles2` are for MediaPipe, not ffmpeg: its Tasks API loads `libmediapipe.so` with ctypes, which
    # NEEDS both. Without them `FaceDetector.create_from_options` raised `OSError: libEGL.so.1` on Modal only (dev
    # machines have them); reframe.py now falls back to the centre on that error, but the tracking would be lost.
    .apt_install(
        "ffmpeg", "curl", "fonts-dejavu-core", "fontconfig", "libegl1", "libgles2",
        "fonts-noto-cjk", "fonts-noto-core", "fonts-noto-color-emoji",
    )
)
cpu_image = (
    _with_engine(cpu_image, face=True)
    # For `submit`: the web app is TypeScript and cannot call `run_job.spawn()` directly; it needs an HTTP
    # endpoint.
    .pip_install("fastapi[standard]")
    .run_commands("mkdir -p /root/models", f"curl -sSLf -o {FACE_MODEL_REMOTE} {FACE_MODEL_URL}")
    .env({"OPENCMO_FACE_MODEL": FACE_MODEL_REMOTE})
)
# Server export (task `render_document`). Only the three exporter packages and the clip fonts. Not the whole
# monorepo: Next and Playwright are hundreds of MB of image nothing here uses.
cpu_image = (
    _with_media(_with_node(cpu_image))
    .add_local_file(_ENGINE / "clip_export_package.json", remote_path=f"{WEB_ROOT}/package.json", copy=True)
    .add_local_dir(_PACKAGES / "clip-doc", remote_path=f"{WEB_ROOT}/packages/clip-doc", copy=True, ignore=_NODE_IGNORE)
    .add_local_dir(
        _PACKAGES / "clip-render", remote_path=f"{WEB_ROOT}/packages/clip-render", copy=True, ignore=_NODE_IGNORE
    )
    .add_local_dir(
        _PACKAGES / "clip-export", remote_path=f"{WEB_ROOT}/packages/clip-export", copy=True, ignore=_NODE_IGNORE
    )
    .run_commands(f"cd {WEB_ROOT} && npm install --omit=dev --no-audit --no-fund")
    .env(
        {
            "OPENCMO_CLIP_EXPORT": f"{WEB_ROOT}/packages/clip-export/src/cli.ts",
            **_MEDIA_ENV,
            # Explainers: the worker makes the voice, then spawns `render_motion` below.
            "OPENCMO_MOTION": "modal",
            # Proof B-roll: task `capture_page` calls `page_capture` below; no Chromium here.
            "OPENCMO_CAPTURE": "modal",
        }
    )
)
# The old name: `modal.App(image=…)`, and every function that names no image of its own uses the CPU image.
image = cpu_image

# Explainers (docs/explainer-build.md): a CPU image of its own for `clip-motion` (Remotion +
# headless Chromium). Rendering is CPU work, so no GPU; the worker image does not carry Chromium.
# Libraries are the ones Remotion lists for Debian; fonts come from clip-media like the exporter.
motion_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "ffmpeg", "curl", "xz-utils",
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libatk-bridge2.0-0", "libgbm1", "libasound2",
        "libxrandr2", "libxkbcommon0", "libxfixes3", "libxcomposite1", "libxdamage1",
        "libpango-1.0-0", "libcairo2", "libcups2",
    )
)
motion_image = (
    _with_media(_with_engine(_with_node(motion_image)))
    # For the `motion_preview` endpoint.
    .pip_install("fastapi[standard]")
    .add_local_dir(_PACKAGES / "clip-motion", remote_path=f"{WEB_ROOT}/packages/clip-motion", copy=True, ignore=_NODE_IGNORE)
    # v2 kit: every Lucide icon (`<Icon>`) is copied into the Remotion bundle, never fetched. The CLI
    # only sees OPENCMO_MOTION_*.
    .add_local_dir(_PACKAGES / "clip-icons" / "data", remote_path=f"{WEB_ROOT}/packages/clip-icons/data", copy=True)
    .env({
        **_MEDIA_ENV,
        "OPENCMO_MOTION_CACHE": "/root/motion-cache",
        "OPENCMO_MOTION_ICONS": f"{WEB_ROOT}/packages/clip-icons/data/icons.json",
    })
    .run_commands(
        f"cd {WEB_ROOT}/packages/clip-motion && npm install --omit=dev --no-audit --no-fund",
        # Remotion's own headless shell, downloaded once at build time, then pinned by path so the
        # CLI wraps it with its offline flags (an unset path would download it again per container).
        f"cd {WEB_ROOT}/packages/clip-motion && node -e \"import('@remotion/renderer').then((r) => r.ensureBrowser())\"",
        "ln -sf \"$(find / -xdev -type f -name chrome-headless-shell -path '*remotion*' 2>/dev/null | head -1)\""
        " /usr/local/bin/chrome-motion && test -x /usr/local/bin/chrome-motion",
    )
    .env({"OPENCMO_CLIP_MOTION": f"{WEB_ROOT}/packages/clip-motion/src/cli.ts", "OPENCMO_MOTION_CHROME": "/usr/local/bin/chrome-motion"})
    # Bundle the composition into the image (cached by source hash under OPENCMO_MOTION_CACHE)
    # and prove the image renders the v2 kit (icons, both themes): a cold container then
    # starts at the render, not at webpack. Remotion rejects a concurrency above the core count, and
    # the image builder may have one core: same rule as `cli_env`, min(cores, 4).
    .run_commands(
        f"cd {WEB_ROOT}/packages/clip-motion && OPENCMO_MOTION_SCALE=0.25"
        ' OPENCMO_MOTION_CONCURRENCY="$(n=$(nproc); [ "$n" -gt 4 ] && n=4; echo "$n")"'
        " node src/cli.ts render fixtures/vaccine.job.json /tmp/warm.mp4 && rm /tmp/warm.mp4",
    )
)

# Page captures (docs/style-skills-build.md, C3): Chromium opens pages the user names and runs their
# JavaScript, so it gets an image and a function of its own with no secrets. Only the engine's
# `opencmo.capture` and Playwright's Chromium are in it; no Node, no ffmpeg, no fonts beyond
# what Playwright's `--with-deps` installs plus Noto for non-Latin pages.
CAPTURE_PLAYWRIGHT = "1.56.0"
capture_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("fonts-noto-core", "fonts-noto-cjk", "fonts-noto-color-emoji")
    .pip_install(f"playwright=={CAPTURE_PLAYWRIGHT}")
    .run_commands("playwright install --with-deps chromium")
)
capture_image = _with_engine(capture_image)

app = modal.App(APP_NAME, image=cpu_image)
secret = modal.Secret.from_name("opencmo")

# The ElevenLabs key is a secret of its own for the same reason: adding it to `opencmo` with `--force` means typing
# every old key again. Without it the web (where Vercel HAS the key) still sells voiceovers while the worker says
# "not set up" on EVERY run: the production failure of 02/10.
#
#   modal secret create opencmo-voice ELEVENLABS_API_KEY=...   # the same key as Vercel
#
# `run_job` needs it for an upload's transcript (ElevenLabs Scribe); `run_task` for captions of
# library files.
voice_secret = modal.Secret.from_name("opencmo-voice")

# fal key, separate for the same reason. Every generated image, video, voice and sound goes
# through fal, so without it the web sells generation that the worker reports as "not set up".
#
#   modal secret create fal-secret FAL_KEY=...   # same key as Vercel
fal_secret = modal.Secret.from_name("fal-secret")

# Explainer previews run code the Assistant wrote: their container gets a token that can only ask
# for previews, never the worker token (it can submit tasks) or the service-role key.
#
#   modal secret create opencmo-motion MOTION_PREVIEW_TOKEN=...   # same value as Vercel's MOTION_PREVIEW_TOKEN
motion_secret = modal.Secret.from_name("opencmo-motion")

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("opencmo.worker")


def _store():
    from opencmo.backends.supabase import SupabaseStore

    return SupabaseStore(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def _record_call(store, job, call) -> None:
    try:
        store.set_call_id(job.id, job.attempt_id, call.object_id)
    except Exception:
        # Only for finding the Modal log; the job's life does not depend on it.
        log.warning("Could not record the call_id of job %s", job.id, exc_info=True)


@app.function(
    secrets=[secret, voice_secret],
    timeout=1800,
    cpu=4,
    memory=4096,
    # No Modal retry (review follow-up L5, owner 2026-11-02): a container that dies midway leaves the job's lease to run
    # out, and the database's reclaim runs it again within its own attempt limit. Both layers retrying ran a job up to
    # six times.
    # Uploads were unbounded at 4 CPU / 4 GiB each, sharing the workspace's container quota with the sweep, submit and
    # MCP (review R6). The database already caps each user at 3 in progress.
    max_containers=20,
)
def run_job(job_id: str, attempt_id: str) -> None:
    """The main entry point. It takes only ids; every job field is read again from the database."""
    from opencmo.worker.process_job import process

    store = _store()
    try:
        job = store.get_job(job_id)
        if job is None or job.status != "running" or job.attempt_id != attempt_id:
            log.info("Job %s: attempt %s is no longer current; skipped", job_id, attempt_id)
            return
        process(store, job)
    finally:
        store.close()


@app.function(
    secrets=[secret, voice_secret, fal_secret],
    timeout=1800,
    cpu=4,
    memory=4096,
    # No Modal retry: the lease reclaim is the one retry layer (L5, as run_job).
    max_containers=RUN_TASK_MAX_CONTAINERS,
)
def run_task(task_id: str, attempt_id: str) -> None:
    """Runs one canonical task; its kind and payload are always read again from the database."""
    from opencmo.worker.kinds import handlers as task_handlers

    handlers = task_handlers()
    store = _store()
    try:
        task = store.get_task(task_id)
        if task is None or task.status != "running" or task.attempt_id != attempt_id:
            log.info("Task %s: attempt %s is no longer current; skipped", task_id, attempt_id)
            return
        handler = handlers.get(task.kind)
        if handler is None:
            store.fail_task(task.id, task.attempt_id, "Unsupported worker task.")
            return
        handler(store, task)
    finally:
        store.close()


@app.function(
    image=motion_image,
    timeout=900,
    cpu=4,
    memory=4096,
    max_containers=4,
    # Runs code the Assistant wrote: no secrets, and Chromium is cut off from the network by the
    # CLI's offline flags. Not `block_network=True`: Modal then cannot hand back results > 2 MiB.
)
def render_motion(payload: dict) -> bytes:
    """Explainer: `{job, audio}` → MP4 bytes. No database or Storage: the worker's `generate`
    task spawns this, polls it, and uploads the result itself.

    Errors leave as `ProviderError` with an English message (Modal pickles it), so the worker
    reports the right sentence to the user.
    """
    from opencmo.ai.providers.motion import render_bytes

    with tempfile.TemporaryDirectory(prefix="opencmo-motion-") as tmp:
        return render_bytes(payload, Path(tmp))


@app.function(
    image=capture_image,
    timeout=90,
    cpu=2,
    memory=2048,
    max_containers=8,
    # No secrets: the page's JavaScript runs here. Network stays on (the page has to load), but
    # every connection goes through `opencmo.capture.guard`, which refuses private, loopback,
    # link-local and metadata addresses. Not `block_network=True`: the page could not load.
)
def page_capture(spec: dict) -> dict:
    """`{url, width, max_height}` → `{png: bytes, boxes: dict}`. The worker's `capture_page`
    task calls this, then moderates and stores the result itself.

    Refusals leave as `CaptureError` with one of the contract's English sentences (Modal pickles
    the message), so the worker writes the right one for the user.
    """
    from opencmo.capture.page import capture

    return capture(spec)


@app.cls(
    image=motion_image,
    secrets=[motion_secret],
    timeout=70,
    # Opening Chromium and loading the bundle happen once per container, before the first preview.
    startup_timeout=120,
    cpu=4,
    memory=4096,
    max_containers=8,
)
class MotionPreview:
    """Explainer previews for the web app's `previewMotion`: `{token, job}` → PreviewResult plus
    `images` (base64 JPEGs).

    The token (`MOTION_PREVIEW_TOKEN`) is in the body like `submit`'s. The scene code runs here and
    never on Vercel, so this container holds only that preview token, never the worker token or
    the service key. One `clip-motion serve` process per container keeps Chromium open, so only a
    cold container pays for starting it.
    """

    @modal.enter()
    def open_browser(self) -> None:
        from opencmo.ai.providers.motion import PreviewSession

        self.session = PreviewSession()
        self.session.start()

    @modal.exit()
    def close_browser(self) -> None:
        self.session.close()

    # Same URL as the v1 function `motion_preview`, so MOTION_PREVIEW_URL does not change.
    @modal.fastapi_endpoint(method="POST", label=f"{APP_NAME}-motion-preview")
    def motion_preview(self, payload: dict) -> dict:

        from fastapi import HTTPException

        expected = os.environ.get("MOTION_PREVIEW_TOKEN", "")
        given = str(payload.get("token") or "")
        if not _token_ok(expected, given):
            raise HTTPException(status_code=401, detail="Invalid preview token.")
        job = payload.get("job")
        if not isinstance(job, dict):
            raise HTTPException(status_code=400, detail="Send the explainer job.")
        with tempfile.TemporaryDirectory(prefix="opencmo-motion-preview-") as tmp:
            try:
                return self.session.preview(job, Path(tmp))
            except RuntimeError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.function(secrets=[secret], timeout=140, cpu=2, memory=2048, max_containers=10)
@modal.fastapi_endpoint(method="POST", label=f"{APP_NAME}-look")
def look(payload: dict) -> dict:
    """Look and listen for Claude over MCP (editor-MCP plan, item 1): `{token, user_id, clip_id, op, input,
    document, manifest}` → `{images: [base64 JPEG], data}` or `{error}`.

    The MCP server calls this with `OPENCMO_LOOK_TOKEN`, not the worker token, which that
    internet-facing container must not hold. The clip's ownership is checked again here with the
    service role before any source is downloaded (`opencmo.worker.look`). A request draws at most
    12 frames with the export's renderer; nothing is stored. `timeout` stays under Modal's 150 s
    cut for web endpoints.

    UNTESTED on Modal (2026-10-20): needs `modal deploy modal_app.py` and `OPENCMO_LOOK_TOKEN` in
    the `opencmo` secret (same value as in `opencmo-mcp`). `opencmo.worker.look` runs in
    `tests/test_worker_look.py`, and once end to end against a local clip-export.
    """

    from fastapi import HTTPException

    from opencmo.worker.look import look as run_look

    expected = os.environ.get("OPENCMO_LOOK_TOKEN", "")
    given = str(payload.pop("token", "") or "")
    if not _token_ok(expected, given):
        raise HTTPException(status_code=401, detail="Invalid look token.")
    store = _store()
    try:
        with tempfile.TemporaryDirectory(prefix="opencmo-look-") as tmp:
            return run_look(store, payload, Path(tmp))
    finally:
        store.close()


@app.function(secrets=[secret], timeout=30)
@modal.fastapi_endpoint(method="POST")
def submit(payload: dict) -> dict:
    """The web app's HTTP door.

    Why: `run_job.spawn()` is a Python API and the web app is TypeScript. Without this endpoint a job waits for
    `sweep()`: on average 30 seconds of a "waiting" screen with nothing running.

    Authenticated with a shared token in the body, not a header: the function signature is evaluated on the DEV
    MACHINE at `modal deploy`, so taking `fastapi.Header` would require fastapi there. A plain `dict` body does not.

    Only `job_id` or `task_id` is taken from the payload; everything else comes from the canonical row the claim RPC
    returns.
    """

    from fastapi import HTTPException

    from opencmo.backends.retry import TransientError

    expected = os.environ.get("OPENCMO_WORKER_TOKEN", "")
    given = str(payload.get("token") or "")
    if not _token_ok(expected, given):
        raise HTTPException(status_code=401, detail="Invalid worker token.")

    job_id = str(payload.get("job_id") or "")
    task_id = str(payload.get("task_id") or "")
    if bool(job_id) == bool(task_id):
        raise HTTPException(status_code=400, detail="Send exactly one job_id or task_id.")

    store = _store()
    try:
        try:
            item = store.claim_job(job_id) if job_id else store.claim_task(task_id, max_running=RUN_TASK_MAX_CONTAINERS)
        except TransientError as exc:
            # The claim is not retried. If it committed, the lease runs out and the job goes back to the queue; if not,
            # the next minute's sweep picks it up.
            log.warning("Submit %s: transient database error, left to the sweep", job_id or task_id)
            raise HTTPException(status_code=503, detail="The database is temporarily unavailable.") from exc

        if item is None:
            log.info("Work %s is already claimed, or every task container is busy (the sweep takes it later)", job_id or task_id)
            return {"ok": True, "already_claimed": True}

        if job_id:
            call = run_job.spawn(item.id, item.attempt_id)
            _record_call(store, item, call)
        else:
            call = run_task.spawn(item.id, item.attempt_id)
    finally:
        store.close()

    log.info("Took %s %s attempt %s from the web", "job" if job_id else "task", item.id, item.attempt)
    return {"ok": True, "call_id": call.object_id}


@app.function(secrets=[secret], timeout=30)
@modal.fastapi_endpoint(method="POST")
def wake(payload: dict) -> dict:
    """Wake the worker without the worker token: runs one `sweep()` early.

    For callers that create work but must not hold `OPENCMO_WORKER_TOKEN` (the MCP server, which
    faces the internet). It takes no job id, so the token can only make the sweep come sooner:
    the sweep claims through the same leases, and a spare run finds an empty queue.
    The token travels in the body for the same reason as in `submit`.
    """

    from fastapi import HTTPException

    expected = os.environ.get("OPENCMO_WAKE_TOKEN", "")
    given = str(payload.get("token") or "")
    if not _token_ok(expected, given):
        raise HTTPException(status_code=401, detail="Invalid wake token.")
    sweep.spawn()
    return {"ok": True}


# One sweep at a time: every `wake` spawns one, and a burst of wakes ran many at once, each dispatching up to
# MAX_DISPATCH CMO calls (review R6). A queued wake sweep still runs, right after the current one.
@app.function(secrets=[secret], schedule=modal.Period(minutes=1), timeout=60, max_containers=1)
def sweep() -> None:
    """The safety net: recover expired leases, then take jobs and tasks still waiting in the queue.

    It takes the whole queue (at most SWEEP_BATCH, and never past RUN_TASK_MAX_CONTAINERS running tasks) and hands it
    to `run_job` / `run_task`; it never runs a pipeline itself: this function times out at 60 seconds, a job takes
    minutes.

    Database errors only warn: the cron runs again in a minute, and a 504 on an empty queue (13/09 11:00) is not an
    incident.
    """
    from opencmo.backends.retry import TransientError
    from opencmo.worker.kinds import task_kinds

    store = _store()
    try:
        # Each phase on its own (review R6): one that fails, for any reason, must not stop the claims and the CMO
        # dispatch after it. They only warn; the sweep runs again in a minute.
        for name, phase in (
            ("Job reconciler", store.reclaim_expired),
            ("Task reconciler", store.reclaim_expired_tasks),
        ):
            try:
                outcome = phase()
                if outcome.get("requeued") or outcome.get("failed"):
                    log.warning("%s: %s", name, outcome)
            except Exception:
                log.warning("%s failed; next sweep tries again", name, exc_info=True)

        try:
            reaped = store.reap_agent_turns()
            if reaped:
                log.warning("Assistant turns closed by the sweep: %s", reaped)
        except Exception:
            log.warning("Turn sweep failed; next sweep tries again", exc_info=True)

        jobs_left = True
        for _ in range(SWEEP_BATCH):
            try:
                if jobs_left:
                    job = store.claim_next_job()
                    if job is not None:
                        log.info("Sweep took job %s attempt %s", job.id, job.attempt)
                        call = run_job.spawn(job.id, job.attempt_id)
                        _record_call(store, job, call)
                        continue
                    # The job queue is empty for this sweep: stop asking (it cost one claim RPC per task).
                    jobs_left = False
                task = store.claim_next_task(list(task_kinds()), max_running=RUN_TASK_MAX_CONTAINERS)
                if task is None:
                    break
                log.info("Sweep took task %s kind %s", task.id, task.kind)
                run_task.spawn(task.id, task.attempt_id)
            except TransientError:
                log.warning("Claim: transient error, retrying next minute", exc_info=True)
                break
            except Exception:
                log.warning("Claim failed; next sweep tries again", exc_info=True)
                break
    finally:
        store.close()
        # Always: the CMO and Schedule queues must not stop because a step above failed.
        _dispatch_cmo()


def _dispatch_cmo() -> None:
    """Send the AI CMO runs waiting in `cmo_runs` to the web app, one call per run.

    Errors only warn: the runs stay queued and the next sweep, a minute later, tries again.
    """
    from opencmo.worker import cmo_dispatch

    web = cmo_dispatch.web_config(dict(os.environ))
    if web is None:
        log.info("OPENCMO_WEB_URL or CRON_SECRET missing: AI CMO runs are not dispatched")
        return
    try:
        db = (os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        if cmo_dispatch.paused_everywhere(dict(os.environ)):
            log.info("AI CMO paused everywhere (OPENCMO_CMO_PAUSED): no slots fired, no runs dispatched")
            return
        # Schedule's clock (P4 A2): due slots become publish_post runs first, so this same sweep dispatches them.
        try:
            fired = cmo_dispatch.claim_due_slots(*db)
            if any(fired.values()):
                log.info("Schedule: %s", fired)
        except Exception:
            log.warning("Schedule claim failed; next sweep tries again", exc_info=True)
        # One route runs both queues; Studio's orders (P2 A2) are counted apart and capped by `dispatch`.
        waiting = cmo_dispatch.count_dispatchable(*db) + cmo_dispatch.count_studio_work(*db)
        if waiting:
            sent = cmo_dispatch.dispatch(*web, waiting)
            log.info("AI CMO: %s waiting, %s dispatched", waiting, sent)
    except Exception:
        log.warning("AI CMO dispatch failed; next sweep tries again", exc_info=True)


# Two retries: one failed call skipped every founder's loops for the day, and cmo_enqueue merges a retry into the run
# already queued, so retrying is safe (review R6).
@app.function(secrets=[secret], schedule=modal.Cron("5 0 * * *"), timeout=330, retries=modal.Retries(max_retries=2, initial_delay=60.0))
def cmo_schedule() -> None:
    """Enqueue the AI CMO loops due today (00:05 UTC, right after the calendar's day starts).

    Only enqueues; `sweep()` dispatches the runs. Once a day on purpose: the loops are daily, and
    enqueuing again after a run finished would run it twice.
    """
    from opencmo.worker import cmo_dispatch

    web = cmo_dispatch.web_config(dict(os.environ))
    if web is None:
        log.error("OPENCMO_WEB_URL or CRON_SECRET missing: the AI CMO schedule did not run")
        return
    log.info("AI CMO schedule: %s", cmo_dispatch.call_cron(*web, "/api/cron/cmo"))


@app.function(secrets=[secret], schedule=modal.Cron("2 * * * *"), timeout=150)
def cmo_digest() -> None:
    """Hourly: release cards held past a day's budget, send each founder's digest at their local hour, email the
    cards about to expire and push new cards (P6). Every send is claimed in SQL, so a second call sends nothing.
    """
    from opencmo.worker import cmo_dispatch

    web = cmo_dispatch.web_config(dict(os.environ))
    if web is None:
        log.error("OPENCMO_WEB_URL or CRON_SECRET missing: the digest did not run")
        return
    log.info("Digest: %s", cmo_dispatch.call_cron(*web, "/api/cron/cmo-digest", timeout=140.0))


@app.function(secrets=[secret], schedule=modal.Cron("0 3 * * *"), timeout=90)
def cleanup() -> None:
    """Daily cleanup of expired files and free accounts (the web route does the work).

    The route deletes users, so it takes its own secret, `CRON_CLEANUP_SECRET`: a leak of the
    `CRON_SECRET` that the CMO routes share cannot delete accounts.
    """
    from opencmo.worker import cmo_dispatch

    url = os.environ.get("OPENCMO_WEB_URL", "").strip().rstrip("/")
    token = os.environ.get("CRON_CLEANUP_SECRET", "").strip()
    if not url or not token:
        log.error("OPENCMO_WEB_URL or CRON_CLEANUP_SECRET missing: cleanup did not run")
        return
    log.info("Cleanup: %s", cmo_dispatch.call_cron(url, token, "/api/cron/cleanup", timeout=75.0))
