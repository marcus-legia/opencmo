# Work split: clip picker, cheap downloads, repurpose and AI CMO over MCP (2026-10-19)

Read [the plan](2026-10-19-clipping-repurpose-mcp-plan.md) first, all of it.

- **Branch:** `plan/product/2026-10-19-clipping-repurpose-mcp`. Every session works on it and the draft PR is shared.
- **Session A — Clip picker (web), manual picking only:** item 1.
- **Session B — Raw-clip fallback and MCP clips:** items 8 and 5. (Item 2 is deferred, item 3 was dropped.)
- **Session C — AI CMO over MCP, Beta badges, MCP checklist:** items 4, 6 and 7.
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
6. **No new server-side Anthropic, Gemini or fal calls.** Moderation keeps using the shared `ANTHROPIC_API_KEY`
   as it does today. No path may run AI moment picking (plan decision 8).
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

- [ ] **A1 — Contract.** `lib/clipping/segments.ts`: `parseSegments(param)` and `segmentProblem` moved here from
  `create.ts` (re-exported there). Push this first.
  - **Accept:** a `segments.check.ts` with valid, overlapping, too long, more than 10, and garbage input.
- [ ] **A2 — Picker view.** Full-size player with timeline, for links and uploads; options; prefill from the URL.
  - **Accept:** typecheck; manual look at 1440 px and 390 px widths, light and dark.
- [ ] **A3 — Submit with segments.** Picked moments go out as `segments`; Make clips is disabled with none. No clip
  count or clip length options. "Try again with longer clips" becomes "Pick again" in both places.
  - **Accept:** the e2e from plan item 1 (two moments on an upload; `jobs.segments` set; no `select` step).
- [ ] **A4 — After the job.** Each clip: Open, "Add voiceover" (opens Generate → Voiceover), "Add explainer" (points to
  `/explain` in Claude over MCP).
  - **Accept:** e2e clicks Open and lands in the edit; one full-size frame looked at.
- [ ] **A5 — Manual-only guard.** zod, `create_job` migration and worker refuse a clip job without segments (plan
  item 1).
  - **Accept:** a 422 in the e2e, a pgTAP case and a worker pytest, each failing on today's code first.

## Session B — Raw-clip fallback and MCP clips

**Owns:**

- `packages/engine/opencmo/pipeline.py` and new engine tests for it
- `apps/web/lib/mcp/` (the `make_clips` tool body, new file)
- `packages/mcp-server/src/groups/clips.ts` (new) and its registration line in `groups/index.ts`, plus its check

Checklist:

- [ ] ~~B1 — Measure~~, ~~B2 — Cut bytes~~, ~~B4 — Probe and subtitle retries~~: deferred with plan item 2 until
  IPRoyal has credit.
- [ ] **B5 — `make_clips` MCP tool.** No job; validates with A1's `segmentProblem`; returns the picker link. Waits for
  A1.
  - **Accept:** `server.check.ts` cases (valid → link, overlap → error result, no segments → error result); manual
    run in claude.ai.
- [ ] **B6 — Raw clips when transcription fails.** Plan item 8. Start here; it depends on no one.
  - **Accept:** the two failing-first pytest cases of item 8; one full-size frame looked at; budgets hold.

## Session C — AI CMO over MCP, Beta badges, MCP checklist

**Owns:**

- `apps/web/lib/cmo/**`, `apps/web/app/api/cron/cmo/**`, `apps/web/app/api/v1/cmo/**`
- `apps/web/components/cmo/**`
- C's migrations and pgTAP files (numbering above)
- `apps/web/components/clipping/BetaBadge.tsx` (new, next to `WorkspaceShell`) and the lines that mount it in `components/editor/TopBar.tsx`,
  `components/clipping/WorkspaceShell.tsx`, `components/editor/generate/GeneratePanel.tsx`,
  `components/editor/visuals/VisualsPanel.tsx`
- `docs/evals/**`, `apps/web/lib/agent/guides.ts` (guide fixes found by the checklist run)

Checklist:

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

## Requests

_Write requests to another session here: date, from, to, what._
