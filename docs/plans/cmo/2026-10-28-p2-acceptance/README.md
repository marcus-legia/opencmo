# P2 acceptance (A6), 2026-10-28

Run in a cloud session on a real local stack: `supabase start` (CLI 2.117.0; PostgREST 14.1 from its GitHub release,
because the registries refused the image), the engine worker from `.venv312` with `OPENCMO_AI_FAKE=1`, `next dev`
with `NEXT_PUBLIC_OPENCMO_UI=v2`. Every real provider key was emptied (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`): no real money.

Script: `apps/web/lib/screens/p2-acceptance.e2e.ts`.

## Result: passes end to end (re-run 2026-10-28, after the PR review fixes)

| Step | Result |
|---|---|
| plan_week with "make 1 video" | one `build_video` order under Studio |
| card 1 | 6 beats, keyframes 7 credits; a stale hash refused |
| edit a beat | card 1 closes as edited and comes back with the founder's words (re-planned by the order runner) |
| card 1 again | approved |
| card 2 | 7 keyframes (contact sheet); keyframe 2 redone, a new contact sheet, approved (video 53 credits) |
| render | 1080×1920, 30 s, video + audio + voice-over captions (`finishVideo`) |
| card 3 | rendered, approved: edit finished, order done with its `video` deliverable, `cut_shorts` ordered by the rule |
| shorts batch | 1 short of 29 s (a 30 s video holds one 15–60 s short), its hook the edited line; approved, one `short` deliverable ready for Schedule |
| Studio | the finished video and the approved short, live |

The first run stopped at the shorts on two gaps in B's paths (render fallback for long-take shots, voice-over
captions without an editor); the re-run found a third (a short's edit lacked the parent's transcripts). All three are
fixed on `cmo-p2`. The screenshots below are from the first run.

## Screens (live, v2 shell)

`dashboard-1440.png`, `dashboard-390.png`, `studio-1440.png`, `studio-390.png`, `brain-1440.png`, `brain-390.png`:
the video item finished in Studio, the video order done and the shorts order stuck (with the squad's reason) on Brain,
Studio stuck on the Dashboard graph.

## Memory

Sampled every second over the worker and its children: the largest single process peaked at 344 MB (render and
generation children included). The summed tree (≈ 9.9 GB) counts shared pages once per process and spans parallel
tasks, so it is not the per-job figure. The three short renders did not run (gap 2), so their peak RSS is still open;
measure it with `/usr/bin/time -v` once the batch renders.

## Also run on this stack

- `supabase test db`: 119 files, 1969 tests, PASS.
- Wave 1 acceptance (`lib/screens/acceptance.e2e.ts`): 8 of 8 steps pass with P2's changes.
