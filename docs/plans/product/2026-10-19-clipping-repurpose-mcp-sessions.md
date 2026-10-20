# Work split: clip picker, cheap downloads, repurpose and AI CMO over MCP (2026-10-19)

Read [the plan](2026-10-19-clipping-repurpose-mcp-plan.md) first, all of it.

- **Branch:** `plan/product/2026-10-19-clipping-repurpose-mcp`. Every session works on it and the draft PR is shared.
- **Session A — Clip picker (web), manual picking only:** item 1.
- **Session B — Raw-clip fallback, MCP clips, look and listen over MCP:** items 8, 5 and 10. (Item 2 is deferred.)
- **Session C — Moderation on Groq, AI CMO over MCP, Beta badges, MCP checklist, daily drafts:** items 3, 4, 6, 7 and 9.
- **Order:** A pushes A1 first. Then A2–A5 and B5 run side by side. B6 and all of C can start at once.

## Rules for all sessions

1. **Own your paths.** Edit only the paths listed for your session. If you need a change in another session's paths,
   write it under "Requests" below and let them make it.
2. **Same branch, no force.**
   - Run `git pull --rebase origin plan/product/2026-10-19-clipping-repurpose-mcp` before every push.
   - Never use `--force`, never rebase pushed commits, never push to `main`.
3. **Small commits.**
   - Prefix each commit with `[A]`, `[B]` or `[C]`.
   - Write commit messages in English.
   - Each commit must be green on its own: typecheck plus the tests of what it touches.
   - End each commit with the attribution lines your tooling gives you.
4. **Update your checklist** in this file, in the same commit that finishes the item. Edit only your own section.
5. **Repo rules still apply** (`CLAUDE.md`):
   - Every write goes through an ownership-checking RPC.
   - Money only moves through the credit module.
   - Every migration has a pgTAP test. Run `scripts/dump-schema.sh` after it; on a `supabase/schema/current.sql`
     conflict, regenerate instead of merging by hand.
   - English everywhere, including SQL `raise exception` text, route errors and MCP error messages. Translate
     Vietnamese comments in lines you touch.
   - Comments explain why.
   - Pipeline budgets: peak RAM < 2 GB, 45-minute video → 5 clips in < 3 minutes. Measure when the pipeline
     changes.
6. **No new server-side Anthropic, Gemini or fal calls.** Moderation moves to Groq (plan item 3, Session C); no
   other path may call Groq. No path may run AI moment picking (plan decision 8).
7. **Test clipping on uploads.** IPRoyal has no credit, so link jobs fail on Modal (plan decision 9).
8. **Numbering, so files don't collide:**

   | Session | Migration timestamps | pgTAP files |
   |---|---|---|
   | A | `202612190…` | `184`–`189` |
   | B | none expected; ask in Requests | none |
   | C | `202612200…` | `190`–`199` |

9. **Heavy suites one at a time:** `db:reset`/`db:test`, `npm run build`, e2e, engine pytest.
10. **Do not deploy.** No `modal deploy`, no `supabase db push`, no Vercel or Modal secret changes. Those are owner
   tasks O1–O5 in the plan. Write the exact steps in the PR body instead.
11. **Tests that change behaviour fail first.** Write the check named in the plan, see it fail on the current code,
    then make it pass.

## Shared contracts

Land these first; others code against them, and they change only through a "Requests" note.

```text
// A1 — picker URL (A owns, B's make_clips builds it)
/app/editor?panel=clips&picker=open&source=<url-encoded source>&segments=<start>-<end>,<start>-<end>
//   opens the full-size picker overlay, not the small panel.
//   seconds as decimals, 1–10 segments, each 1–180 s, no overlap (same rules as
//   apps/web/lib/clipping/create.ts segmentProblem). Invalid or missing segments: open the picker empty.
```

```text
// C1 — CMO brain flag (C owns)
OPENCMO_BRAIN=claude   honoured in every environment: every CMO job thinks through the inbox (MCP);
                       no server-side model call from lib/cmo
```

A must land A1 (the URL parser, even before the picker UI) before B builds `make_clips` on it. B should export the
segment validator for both to use; until then B calls the same rules through a shared helper that A puts in
`apps/web/lib/clipping/segments.ts` (A owns it).

## Session A — Clip picker (web)

**Owns:**

- `apps/web/components/editor/clipping/**`
- `apps/web/components/clipping/web/{YouTubePlayer,SegmentBar,ClipStudio}.tsx` (restore the last two from
  `d1f6d623^`)
- `apps/web/components/clipping/OutputOptions.tsx` if restored
- `apps/web/app/app/video/page.tsx` and any new picker route under `apps/web/app/app/editor/`
- `apps/web/lib/clipping/segments.ts` (new: parse and validate the URL segments, shared with B) and
  `apps/web/lib/clipping/create.ts`
- `apps/web/components/clipping/ProjectResults.tsx` (the "Try again with longer clips" button)
- the manual-only guard in `packages/engine/opencmo/worker/process_job.py` and its pytest (new)
- A's migration and pgTAP files (numbering above)
- the picker's CSS in `apps/web/app/globals.css` (new block only)
- `apps/web/e2e/editor-clipping.spec.ts`

Checklist:

- [x] **A1 — Contract.** `lib/clipping/segments.ts`: `parseSegments(param)` and `segmentProblem` moved here from
  `create.ts` (re-exported there). Push this first.
  - **Accept:** a `segments.check.ts` with valid, overlapping, too long, more than 10, and garbage input.
  - *Done:* `parseSegments`, `formatSegments`, `pickerPath` (B: build the `make_clips` link with it) and
    `segmentProblem` (empty list → "Pick at least one moment to clip."); `segments.check.ts` runs in `check:contracts`.
- [x] **A2 — Picker view.** Full-size player with timeline, for links and uploads; options; prefill from the URL.
  - **Accept:** typecheck; manual look at 1440 px and 390 px widths, light and dark.
  - *Done (2026-10-20):* `components/editor/clipping/MomentPicker.tsx` and `components/clipping/web/SegmentBar.tsx`.
    Looked at 1440 and 390 px, light and dark: no overflow, handles and labels readable. Named `MomentPicker` because
    `components/editor/ClipPicker.tsx` (the top bar's clip menu) already owns `data-testid="clip-picker"`.
- [x] **A3 — Submit with segments.** Picked moments go out as `segments`; Make clips is disabled with none. No clip
  count or clip length options. "Try again with longer clips" becomes "Pick again" in both places.
  - **Accept:** the e2e from plan item 1 (two moments on an upload; `jobs.segments` set; no `select` step).
  - *Done:* `editor-clipping.spec.ts` green (two moments → 2 clips of 6 s and 8 s; no moments → 422). Run here with
    `E2E_VIDEO_CODEC=vp9` and Playwright's Chromium, which DeviceCheck refuses for lack of H.264, so the run stubbed
    `canPlayType` locally (not committed); CI's Chrome needs neither. `output-options` and `upload-resume` (updated for
    the picker) pass the same way.
- [ ] **A4 — After the job.** Each clip: Open, "Add voiceover" (opens Generate → Voiceover), "Add explainer" (points to
  `/explain` in Claude over MCP).
  - **Accept:** e2e clicks Open and lands in the edit; one full-size frame looked at.
- [x] **A5 — Manual-only guard.** zod, `create_job` migration and worker refuse a clip job without segments (plan
  item 1).
  - **Accept:** a 422 in the e2e, a pgTAP case and a worker pytest, each failing on today's code first.
  - *Done:* zod (`create.check.ts`), migration `20261219000000` + pgTAP 184, worker
    (`test_worker_manual_moments_guard.py`), each red on the old code first. The migration also gives `create_video_pack`
    `p_segments` (owner, 2026-10-20); see Requests.

## Session B — Raw-clip fallback, MCP clips, look and listen over MCP

**Owns:**

- `packages/engine/opencmo/pipeline.py` and new engine tests for it
- `apps/web/lib/mcp/` (the `make_clips` tool body, new file)
- `packages/mcp-server/src/groups/clips.ts` (new) and its registration line in `groups/index.ts`, plus its check
- item 10: `packages/mcp-server/src/groups/look.ts` (new) and its registration line, the `look` function in
  `packages/engine/modal_app.py` (new block only), a new frame entry in `packages/clip-export/src/` and its test, the
  opencmo server instructions in `packages/mcp-server/src/server.ts`. Guide text in `apps/web/lib/agent/guides.ts` is
  C's: ask in Requests.

Checklist:

- [ ] ~~B1 — Measure~~, ~~B2 — Cut bytes~~, ~~B4 — Probe and subtitle retries~~: deferred with plan item 2 until
  IPRoyal has credit.
- [ ] **B5 — `make_clips` MCP tool.** No job; validates with A1's `segmentProblem`; returns the picker link. Waits for
  A1.
  - **Accept:** `server.check.ts` cases (valid → link, overlap → error result, no segments → error result); manual
    run in claude.ai.
- [ ] **B6 — Raw clips when transcription fails.** Plan item 8. Start here; it depends on no one.
  - **Accept:** the two failing-first pytest cases of item 8; one full-size frame looked at; budgets hold.
- [ ] **B7 — `capture_frame` over MCP.** Plan item 10a plus the `look` Modal function. After B6; depends on no one.
  - **Accept:** `server.check.ts` cases; the frame-vs-export match test; one contact sheet looked at; peak RAM measured.
- [ ] **B8 — `inspect_color`, `media_grab`, `media_waveform`.** Plan items 10b–10d on the same function.
  - **Accept:** `server.check.ts` cases per tool; a waveform case on a fixture with a known 2 s silence.
- [ ] **B9 — Versions, then `save_frame`.** Plan items 10f and 10e.
  - **Accept:** a restore round trip in `server.check.ts` (edit → list → restore → document equals the old one); pgTAP
    if a new RPC is needed (ask in Requests for numbers).

## Session C — Moderation on Groq, AI CMO over MCP, Beta badges, MCP checklist, daily drafts

**Owns:**

- `apps/web/lib/generate/moderation.ts` and its check, `packages/engine/opencmo/ai/moderation.py` and its pytest,
  `packages/engine/opencmo/deploy_env.py` (item 3)
- `apps/web/lib/cmo/**`, `apps/web/app/api/cron/cmo/**`, `apps/web/app/api/v1/cmo/**`
- `apps/web/components/cmo/**`
- C's migrations and pgTAP files (numbering above)
- `apps/web/components/clipping/BetaBadge.tsx` (new, next to `WorkspaceShell`) and the lines that mount it in `components/editor/TopBar.tsx`,
  `components/clipping/WorkspaceShell.tsx`, `components/editor/generate/GeneratePanel.tsx`,
  `components/editor/visuals/VisualsPanel.tsx`
- `docs/evals/**`, `apps/web/lib/agent/guides.ts` (guide fixes found by the checklist run)
- item 9: `apps/web/components/editor/assistant/ContinueInClaude.tsx`, `plugins/opencmo-claude/skills/opencmo/SKILL.md`,
  and the `/daily` prompt (in `lib/cmo/mcp/prompts.ts`)

Checklist:

- [ ] **C0 — Moderation on Groq.** Plan item 3. Start here: voiceover and the C4 run need it.
  - **Accept:** the failing-first cases in `moderation.check.ts` and the engine pytest; the chosen model ids and one
    real call per checker written into the plan; a voiceover end to end with no Anthropic credit.
- [ ] **C1 — Brain flag in production.** `OPENCMO_BRAIN=claude` honoured everywhere; skip `classify_edits`;
  `create_video_pack` passes the brain; W0 offers "Continue in Claude".
  - **Accept:** `brain.check` case for production; pgTAP for the video-pack migration. The production run of
    "Plan my week" is a post-deploy check (after O2 and O4) listed in the PR body.
- [ ] **C2 — Inbox fixes.** Findings 1, 3, 4, 5 of `docs/mcp-agent-team-sessions.md:356-372`; wake after submit (6);
  `create_task` starts `summarize_memory` and `review_week`.
  - **Accept:** pgTAP per SQL fix; `jobs.check.ts` for the memoized calendar item; `inbox.e2e.ts` green.
- [ ] **C3 — Beta badges.** Component plus the four surfaces.
  - **Accept:** typecheck; a look at each surface, light and dark.
- [ ] **C4 — MCP editor checklist.** `docs/evals/mcp-editor-checklist.md`; one run through claude.ai with results, on
  an uploaded fixture video.
  - **Accept:** `docs/evals/results/2026-10-xx.md`; each failure fixed in a guide or tool description, or filed as an
    issue.
- [ ] **C5 — Daily drafts from claude.ai.** Plan item 9. Write the 9a spike steps for the owner first (O6); build 9b–9d
  only once the spike says Cowork scheduled tasks load our connector, else switch to routines and update the plan.
  - **Accept:** a `server.check.ts` case for the `/daily` prompt;
    typecheck; the 7-day production check (after O6) listed in the PR body as post-deploy.

## Requests

_Write requests to another session here: date, from, to, what._

- **2026-10-20, A → C: video packs need picked moments.** Owner decision (2026-10-20): a CMO video pack is picked by hand
  like any clip job. A's migration `20261219000000_manual_clip_moments.sql` gives `create_video_pack` a fourth argument,
  `p_segments jsonb`, and passes it to `create_job`, which refuses a clip job without moments ("Pick at least one moment
  to clip."). Until C wires it, "New video pack" fails with that message. C, please:
  - `app/api/v1/cmo/video-packs/route.ts`: accept `segments` (same zod shape and `segmentProblem` as
    `lib/clipping/create.ts`) and send `p_segments`; drop `clips`.
  - `components/cmo/workspace/NewVideoPack.tsx`: open A's full-size picker (`components/editor/clipping/MomentPicker.tsx`,
    props documented there) on the chosen file or link, and send the picked moments. The caption step is unchanged.
  - Status: open.
