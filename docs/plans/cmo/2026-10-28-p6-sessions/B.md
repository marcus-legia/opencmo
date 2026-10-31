# Session B: look check, evals, Hacker News, X threads

Plan: [`../2026-10-28-p6-quality-reach-plan.md`](../2026-10-28-p6-quality-reach-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/departments/studio/` (the look check hook)
- `packages/engine/opencmo/worker/look.py` (only if the fixed questions change)
- `apps/web/lib/cmo/jobs/eval/` (Studio and brain cases, the plan judge)
- `apps/web/lib/cmo/social/hn.ts` (new) and its use in `sales-scan.ts` / research (through a request to A if it touches A's files)
- `apps/web/lib/cmo/jobs/draft-post.ts` (thread mode), thread posting in `apps/web/lib/departments/publish/zernio.ts`

## Order

B0 → (push, M1) → B1 → B2 (editor first, M2) → B3 → B4.

## Todo

- [x] **B0 Contracts (push first)**: `LookResult` (questions, pass/fail, frame times, note), where it runs (before a
      card, never on every render unless the owner says so at M1); eval case shapes (squad: brief → output → judge
      questions; brain: profile → plan → judge); `HnSource`; thread draft type (5–8 posts, each ≤ 280).
- [ ] **B1 Look check (S4)**: before a video, short or slideshow card (long take, Shorts, Slideshow squads in
      `lib/departments/studio/`), call Modal `look` on the full-size export (up to 12 frames); fixed questions; one
      send-back to the squad, then the card shows the note.
- [ ] **B3 Hacker News (R4)**: Algolia HN search (no key, within its rate limit) for Sales and Research, budget,
      untrusted wrapping, tests with recorded responses.
- [ ] **B4 X threads (W4)**: `post_draft` thread mode (hook post with the promise, one step per post, no recap
      ending, checks per post), posting as a thread through the publish adapter.
- [ ] **B2 Evals (S4, B4)**: Studio cases for long take, shorts and slideshows; ~20 brain profiles with the plan
      judge on the cascade; a fake run in CI; the real run waits for the owner.

## Notes for M1

- **Look check rule (owner, 2026-10-31): only before a card.** `LOOK_CHECK_RULE = "before_card"`; draft renders in the
  editor are never checked.
- **Contracts:** `lib/departments/studio/look-check.ts` (questions, `LookResult`, `LookCheckInput`, one send-back,
  `lookNote`; checked in `studio.check.ts`), `packages/engine/opencmo/worker/look_check_task.py` (the worker contract,
  built in B1), `lib/cmo/jobs/eval/studio-types.ts` (squad cases, brain profiles, the plan judge's questions),
  `lib/cmo/social/hn.ts` (`HnSource`, `HnThread`, `HnBudget`), `ThreadDraftSchema` / `ThreadBody` in
  `lib/cmo/writer/types.ts`.
- **Black, frozen and silence are code, not a model:** ffmpeg `blackdetect`, `freezedetect` and `astats` on the
  full-size file; only "captions inside" and "text readable" go to the vision judge (Python, beside
  `opencmo/ai/moderation.py`, which already holds the vision calls). No vision key → "not checked", never a fail.
- **Cards are raised in SQL**, so the wait for the look check is A's (request 1 in `A.md`); HN rows need A's
  constraint change (request 2), threads need `cmo_save_draft` and the card block (request 3).
- **Zernio threads exist:** OpenAPI v1.429 has `TwitterPlatformData.threadItems[] {content, mediaItems}`
  (`platformSpecificData`, item 0 is the root post), checked on `zernio.com/openapi.json` 2026-10-31.

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)
