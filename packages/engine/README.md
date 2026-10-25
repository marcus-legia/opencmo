# opencmo-engine

The video side of OpenCMO: turns an uploaded video into one editable project (the editor
master and a word-level transcript), and runs the worker tasks behind the editor — exports,
media probes, transcripts, AI generation and page captures.

It **knows nothing about the web**, so it can be tested without any infrastructure, and
deploying to Modal is only packaging.

## Install

```bash
# ffmpeg is required
sudo apt install ffmpeg          # Debian/Ubuntu
brew install ffmpeg              # macOS

uv venv --python 3.12 .venv && source .venv/bin/activate
pip install -e '.[dev,face]'   # face: MediaPipe for face tracking on upload (optional)
```

## Configure

```bash
cp .env.example .env    # then export it, or use direnv
```

You need `ELEVENLABS_API_KEY` (transcripts, ElevenLabs Scribe) and `ANTHROPIC_API_KEY`
(moderation).

```bash
opencmo doctor          # check the environment first
```

Only process video the user owns or has the right to edit.

## An upload, step by step

```
probe (header only, signed URL) → settle credits → download the upload once
      → remux into the editor master (-c copy) → audio → speech-to-text
      → publish one `full` clip with its master and transcript
```

See `packages/engine/opencmo/worker/process_job.py` and `ARCHITECTURE.md` §3. The clipping
pipeline (link downloads, AI moment selection, vertical clips) was removed on 2026-10-20.

## Budget to keep

| | Budget |
|---|---|
| Peak RAM per job | **< 2 GB** |

Measure RAM after any pipeline change with `/usr/bin/time -v` and look at
`Maximum resident set size`.

## Deploy the worker to Modal

In production the engine runs as a Modal worker — see `modal_app.py`.

```bash
pip install -e '.[worker]'

modal secret create opencmo \
    ANTHROPIC_API_KEY=... \
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...

modal deploy modal_app.py
```

## Test

```bash
pip install -e '.[dev]'
pytest
```

Most tests cover pure logic — transcripts, settings, errors, the worker loop — and run without
network access or API keys. Some tests render with a real ffmpeg, and `test_web_sql_concurrency`
needs the local Supabase stack. `tests/e2e_worker.py` is the fixture worker the browser E2E
starts: the real worker with speech-to-text replaced.
