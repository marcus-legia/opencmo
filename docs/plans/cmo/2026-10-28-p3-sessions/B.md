# Session B: Writer pipeline

Plan: [`../2026-10-28-p3-writer-plan.md`](../2026-10-28-p3-writer-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/cmo/writer/` (new: types, prompts per kind)
- `apps/web/lib/cmo/jobs/draft-post.ts`, `check-post.ts`, `classify-edits.ts`, `edit-taxonomy.ts`, `apps/web/lib/cmo/jobs/eval/`
- `apps/web/lib/cmo/skills/` (`no-ai-slop.md`, `x-writing.md`, `LICENSE.md`, `index.gen.ts`), the No AI Slop entry in `THIRD_PARTY_NOTICES.md`
- `apps/web/lib/cmo/agents/registry.ts` (writer agents per profile)
- the call from P2's `lib/departments/studio/` `buildVideo` to the brief (only the brief type import)

## Order

B0 → (push, M1) → B1 → B2 (after A0) → B3 (after A1) → B4 (after A2).

## Todo

- [ ] **B0 Writer interface (push first)**: `lib/cmo/writer/types.ts`: `draft(kind, profile, brief, context)` for
      `post`, `caption`, `youtube`, `video_brief`, `slides`; inputs (brief, documents, voice notes, corrections,
      profile) and outputs (versions with angle and rationale; for captions one per platform; for the brief angle,
      3 hooks, key points, CTA, seconds, aspect); the video brief type is the one P2's adapter takes (move it here if
      P2 defined it in the adapter, through a request to its owner if needed).
- [ ] **B1 W0**: `no-ai-slop.md` from the attached repo (principles and patterns only, ~1,700 words, MIT notice in
      `skills/LICENSE.md` and `THIRD_PARTY_NOTICES.md`), regenerate the index; `x_writer`, checker, `sales` and CMO
      chat load it; remove the three patterns from `x-writing.md` (lines 13, 16, 23); fix the fake drafts
      (`draft-post.ts` line 57 and the e2e/check copies); `check-post.ts`: no links and no hashtags in posts. Eval
      cases before and after (fake provider); the real run waits for the owner.
- [ ] **B2 W1**: `draft-post` takes a profile; one writer agent per profile in the registry with the same cached
      prefix; checks from `platforms.json` (limit, visible before "more" as advice on LinkedIn); 3 versions per
      platform from one idea.
- [ ] **B3 W2**: the writer reads the top voice notes (newest first, weight by age) and tier 0 corrections after the
      cached prefix; the founder's voice beats the skill; `classify-edits` writes notes through A1's RPC; outside text
      never becomes a note.
- [ ] **B4 W3**: `write_video_brief` (called by A2's rule before `buildVideo`), `write_caption` per platform (hashtags
      only here, per profile max), YouTube title + description, `write_slides` (5–10 slides, hook first, CTA last,
      no invented numbers); a unit test per kind and one fake-provider run end to end.

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)
