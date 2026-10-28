# Session B: look check, evals, Hacker News, X threads

Plan: [`../2026-10-28-p6-quality-reach-plan.md`](../2026-10-28-p6-quality-reach-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/departments/studio/` (the look check hook)
- `packages/engine/opencmo/worker/look.py` (only if the fixed questions change)
- `apps/web/lib/cmo/jobs/eval/` (Studio and brain cases, the plan judge)
- `apps/web/lib/cmo/social/hn.ts` (new) and its use in `sales-scan.ts` / research (through a request to A if it touches A's files)
- `apps/web/lib/cmo/jobs/draft-post.ts` (thread mode), thread posting in `apps/web/lib/departments/publish/zernio.ts`

## Order

B0 → (push, M1) → B1 → B3 → B4 → B2.

## Todo

- [ ] **B0 Contracts (push first)**: `LookResult` (questions, pass/fail, frame times, note), where it runs (before a
      card, never on every render unless the owner says so at M1); eval case shapes (squad: brief → output → judge
      questions; brain: profile → plan → judge); `HnSource`; thread draft type (5–8 posts, each ≤ 280).
- [ ] **B1 Look check (S4)**: before a video, short or slideshow card, call Modal `look` on the full-size export (up
      to 12 frames); fixed questions; one send-back to the squad, then the card shows the note.
- [ ] **B3 Hacker News (R4)**: Algolia HN search (no key, within its rate limit) for Sales and Research, budget,
      untrusted wrapping, tests with recorded responses.
- [ ] **B4 X threads (W4)**: `post_draft` thread mode (hook post with the promise, one step per post, no recap
      ending, checks per post), posting as a thread through the publish adapter.
- [ ] **B2 Evals (S4, B4)**: Studio cases for long take, shorts and slideshows; ~20 brain profiles with the plan
      judge on the cascade; a fake run in CI; the real run waits for the owner.

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)
