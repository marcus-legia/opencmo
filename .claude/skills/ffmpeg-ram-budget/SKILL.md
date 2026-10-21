---
name: ffmpeg-ram-budget
description: Use when adding or changing any ffmpeg/ffprobe command that reads user media in packages/engine (uploads, masters, previews, renders, waveforms, frames), or when a worker job's memory or time is in question. Enforces the 2 GB per-job budget with a real measurement.
---

# ffmpeg and the RAM budget

CLAUDE.md: **peak RAM per job < 2 GB**. The upload worker (`run_job` in `packages/engine/modal_app.py`) has 4 CPUs
and 4,096 MB; going over kills the container mid-job, and Modal retries it.

Incident (#95): `make_editor_master` (`packages/engine/opencmo/worker/media.py`) falls back to a full `libx264` encode
when MP4 can't hold the upload's codecs. It ran at source size on default threads: **4,136 MB** on a 3 s 8K FFV1
clip. Capped to 3840 px on 4 threads: **1,164 MB**, and 2.5× faster.

## Rules

- Stream copy (`-c copy`) decodes nothing and is cheap at any size. A decode or encode scales with frame size and
  threads.
- Every decode/encode of user media bounds both:
  - size: `scale=w='min(iw,N)':h='min(ih,N)':force_original_aspect_ratio=decrease:force_divisible_by=2` (never
    upscales, keeps the aspect, even dimensions for `yuv420p`);
  - threads: `-threads <container CPUs>`.
- `veryfast` already uses `rc-lookahead=10`; raising lookahead costs memory.
- Read sizes downstream from the output (`probe_file(master)`), never assume output size == source size.
- The rest still applies: `-ss` before `-i`, `USER_INPUT` / `USER_MEDIA_FORMATS` for user files, no frames in Python,
  cap parallel ffmpeg processes.

## Measure, don't estimate

Make an input that really reaches the path. An MJPEG + PCM MKV is copied into MP4 and never encodes; FFV1 isn't, so
it forces the fallback:

```bash
S=<scratch dir>
ffmpeg -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=7680x4320:rate=30 \
  -f lavfi -i sine=frequency=440 -t 3 -c:v ffv1 -c:a pcm_s16le "$S/in8k.mkv"
```

Then measure through the real function, before and after (`git stash` the change for the before run):

```bash
cd packages/engine && .venv312/bin/python -I -c '
import resource, sys, time; sys.path.insert(0, ".")
from pathlib import Path
from opencmo.worker import media
from opencmo.media.probe import probe_file
S = Path(sys.argv[1]); t = time.time()
media.make_editor_master(S / "in8k.mkv", S / "m.mp4")
i = probe_file(str(S / "m.mp4"))
print(i.width, i.height, "peak MB", resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss // 1024, "s", round(time.time() - t, 1))
' "$S"
```

`/usr/bin/time -v` is the CLAUDE.md tool when installed; `ru_maxrss` of children is the same number. Put the
before/after table in the PR and delete the sample files.

## Tests

Patch the cap small (`monkeypatch.setattr(media, "MAX_ENCODE_SIDE", 320)`) and feed a small huffyuv/FFV1 + PCM file,
so the test is fast but still takes the encode path. Assert the output fits, keeps the aspect, and that a small
source is not upscaled.
