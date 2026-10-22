# Baseline frames (Task A0, before any motion-quality change)

**How they were made.** The local stack could not start in the cloud session (the Supabase CLI could not pull its
images: "Data limit exceeded"), so there was no local MCP server to connect to. Claude played the MCP client
instead. It wrote each storyboard and scene from `read_guide "explainer"` as it stood on `main` (no `direction`,
"at most 3 rounds"), then ran each round through `node packages/clip-motion/src/cli.ts preview`, the same preview
that `preview_explainer` returns. Both runs are 16:9, as on a blank 16:9 New edit, without accent or images. The
final render is `clip-motion render` with no narration, so timings are the estimate.

| File | What |
|---|---|
| `brief1-stills.jpg` | The last clean preview of brief 1: six stills at half size (beat midpoints and the last frame). |
| `brief1-mid-15s.jpg` | Full-size frame at 15 s of the brief 1 render (30 s, 900 frames). |
| `brief2-stills.jpg` | The last clean preview of brief 2. |
| `brief2-mid-10s.jpg` | Full-size frame at 10 s of the brief 2 render (20 s, 600 frames). |

## Brief 1: "How OpenCMO turns one long video into a week of clips"

- Writer: Claude (cloud session). Theme blueprint, personality corporate, 5 beats, 30 s.
- Rounds: 3. Round 1 was a render error (an unknown icon `upload-cloud`). Round 2 returned 4 "85% empty" issues,
  and the clapperboards and scissors had not appeared yet at the beat midpoints. Round 3 left one issue
  (empty at 0.2 s).
- Time: about 6 minutes of model work and 15–20 s per preview. Render: 109 s, 120 ms/frame.
- Peak RAM of the render: 584 MB in the largest single process, 1,559 MB summed over the process tree with
  Chromium (`/usr/bin/time` is missing in the container, so these come from `RUSAGE_CHILDREN` and `/proc` sampling).
- The three worst problems:
  1. **A slide deck of icons.** Each beat is a new pair of isolated line icons with an arrow between them. There is
     no visual centre that carries over from beat to beat, and nothing transforms.
  2. **Nothing from the real product.** The scene explains OpenCMO without a single screenshot of it. The kit cannot
     show an image.
  3. **Timing left to the estimate.** The board fills only one line by the beat midpoint, and the check lands on
     the calendar's corner (the two marks overlap). Nothing in the spec said where each move starts and ends, so
     the frames show leftovers.

## Brief 2: "Three things a solo founder should automate first" (20 s)

- Writer: Claude (cloud session). Theme blueprint, personality energetic, 5 beats, 20 s.
- Rounds: 2. Round 1 had 5 "85% empty" issues and the counter still read 2 at the first still. Round 2 had no issues.
- Time: about 4 minutes. Render: 73 s, 119 ms/frame. Peak RAM: 578 MB in the largest single process, 1,560 MB summed
  over the tree.
- The three worst problems:
  1. **Same template feel.** Heading, then one or two neon icons, then a check. The "energetic" personality reads
     like "corporate" because only entrances move.
  2. **The checklist is a plain board** with small text in the left half and a big check on the right. There is no
     tick animation per item and no build-up.
  3. **The layout report passed a weak frame.** Round 2 had no issues, but the frames are still mostly empty
     background. "No issues" is a floor, not a bar.

## What this baseline says for Session A

- Need a numeric spec before code (`direction`). Brief 1's overlaps and leftovers came from moves nobody had planned.
- Need to choose the preview times. Beat midpoints missed the moments that mattered: the counter mid-count, and the
  board half-filled.
- Need images in scenes (`kit.Image`). An OpenCMO explainer without OpenCMO on screen is the biggest gap.
