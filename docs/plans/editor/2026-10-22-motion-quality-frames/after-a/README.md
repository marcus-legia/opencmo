# After Session A (Task A6)

The two baseline briefs ([`../baseline/README.md`](../baseline/README.md)), run again on the branch with Session A's
loop: storyboard → `direction` (a motion spec with numbers) → code → preview at times picked around each move →
answer the review checklist → fix the one worst problem → preview again.

**How they were made.** Claude played the MCP client again, writing each scene the way the new guide asks and
previewing each round through `clip-motion preview`. This time the local Supabase ran (auth + storage; the CLI started
once logflare and the other unused services were excluded). That made two real paths possible:

- **Preview with a real image.** The OpenCMO landing page, served by `next dev` from this branch and captured at
  1600×900, was uploaded to the local `media` bucket. The preview job carried a 600 s signed URL, the same shape as
  `previewAssets`. `inlineAssets` fetched it from `OPENCMO_MOTION_ASSET_ORIGIN=http://127.0.0.1:54321` before Chromium
  opened.
- **Render with the worker's inlining.** The final job's image came from `motion_assets`: owner-checked path,
  image2pipe re-encode, JPEG (no alpha), 1600×900, 200 KB data URI. Then `clip-motion render` at full size.

The in-app Assistant could only be checked with the fake model (no LLM key in the container):
`OPENCMO_MOTION=local npm run agent:eval -- --provider fake` passes 43/43, including `explain-make` and
`explain-vaccine`, which preview through the local CLI and reach the price card with a `direction`.

| File | What |
|---|---|
| `brief1-stills-round1.jpg`, `brief1-stills.jpg` | Brief 1: the 12 stills of round 1 and of the last round (4). |
| `brief1-full-1.5s.jpg`, `brief1-full-13s.jpg` | Full-size frames of the brief 1 render (30 s): the real screen, then cut by words. |
| `brief2-stills-round1.jpg`, `brief2-stills.jpg` | Brief 2: round 1 and the last round (4). |
| `brief2-full-10s.jpg` | Full-size frame of the brief 2 render (20 s). |
| `brief*-direction.txt`, `brief*.scene.jsx` | The direction and the scene code of the last round. |

## Brief 1: "How OpenCMO turns one long video into a week of clips"

- Paper theme, corporate personality, accent `#EE4B1E`, 5 beats, 30 s, one image asset (`landing`).
- Rounds: 4 (baseline: 3). About 12 minutes of model work (baseline: about 6); previews took 19 s each with 12 stills
  (baseline: 15 s with 6).
- What each round fixed, picked with the checklist:
  1. The report flagged the closing check in the caption zone. The checklist's worst problem was different: the "long
     video" strip was an empty bar that did not read as footage.
  2. Frames of the real screen inside the strip. The checklist then found the transcript words unreadable on top of
     those frames.
  3. The frames step aside while the words are on the strip. Next worst: "transcribing…" over the frames.
  4. Text moved under the strip. Round 4 found nothing worth another round.
- Render: 900 frames, 104 s, 114 ms/frame. **Peak RAM: 587 MB** in the largest single process, **1,614 MB**
  summed over the whole process tree with Chromium (`/proc` sampling; `/usr/bin/time` is missing in the container).
  Baseline: 1,559 MB. Under the 2 GB budget.
- Three worst problems now:
  1. Beats 2–5 still use line icons for the ideas (upload, scissors, image, clapperboard). Only beat 1 shows the real
     product. Screens of the editor itself (cut by words, B-roll) would carry beats 3–4 better. They need a signed-in
     capture, which this session did not have.
  2. Word spacing on the strip is a fixed 152 px per slot, so short and long words sit unevenly ("uh becomes").
  3. A 1.5 s pause before the clapperboards appear leaves the right half empty (3.9 s still).

## Brief 2: "Three things a solo founder should automate first" (20 s)

- Blueprint theme, energetic personality, 5 beats, 20 s.
- Rounds: 4 (baseline: 2). About 8 minutes.
  1. Round 1 had no layout issues, but the checklist found "Posts: drafted, you approve" running into its check mark.
     **The layout report only compares text with text, so the checklist caught this one.**
  2. Shorter text, check moved right. Clean.
  3. The checklist's worst problem was a card too small for the frame. The bigger card then left the safe area, which
     the report caught at 25 times.
  4. Card moved up. Clean.
- Render: 600 frames, 102 s, 167 ms/frame. Peak RAM: 579 MB single process, 1,643 MB process tree.
- Three worst problems now:
  1. One card the whole time holds attention well, but the motion is only entrances, swaps and pops. Nothing moves
     through space; a device frame or a template (Session B) would do more.
  2. The headline changes every beat, while the card already says the same thing ("1. Invoices" over
     "Invoices: automatic").
  3. The last 4 s show the same card. The 1.05 scale on beat 5 is too small to read as an ending.

## Did the new checks catch anything real?

- **The checklist, yes, in every round.** Each round fixed the one worst problem it named. Three of the four fixes in
  brief 1 and two of the three in brief 2 were problems the layout report cannot see (an empty strip, text on busy
  frames, text touching a mark, a card too small for the frame).
- **`jumpIssues`, nothing in these two scenes** (no move of more than 130 px in one frame). On a test scene with a
  one-frame cut it reported `"Icon rocket" jumps 900 px in one frame at 2.3 s`. It only sees jumps at sampled frames
  (6 frames after each beat start and each beat's midpoint).
- **Chosen times, yes.** In brief 1 they caught the screenshot mid-shrink (3.9 s) and the clips arriving (4.8 s), two
  moments the default beat midpoints miss.
- **Preview cost.** A 16-beat explainer with 12 chosen stills took 46 s once every layout sample also rendered its
  next frame: too close to the 55 s preview endpoint. The jump check is now capped at 12 partner frames per preview,
  which brings that job to 36 s. Jobs of up to 6 beats keep every pair.
