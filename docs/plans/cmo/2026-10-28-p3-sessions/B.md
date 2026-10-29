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

- [x] **B0 Writer interface (push first)**: `lib/cmo/writer/types.ts`: `draft(kind, profile, brief, context)` for
      `post`, `caption`, `youtube`, `video_brief`, `slides`; inputs (brief, documents, voice notes, corrections,
      profile) and outputs (versions with angle and rationale; for captions one per platform; for the brief angle,
      3 hooks, key points, CTA, seconds, aspect); the video brief type is the one P2's adapter takes (move it here if
      P2 defined it in the adapter, through a request to its owner if needed).
- [x] **B1 W0**: `no-ai-slop.md` from the attached repo (principles and patterns only, ~1,700 words, MIT notice in
      `skills/LICENSE.md` and `THIRD_PARTY_NOTICES.md`), regenerate the index; `x_writer`, checker, `sales` and CMO
      chat load it; remove the three patterns from `x-writing.md` (lines 13, 16, 23); fix the fake drafts
      (`draft-post.ts` line 57 and the e2e/check copies); `check-post.ts`: no links and no hashtags in posts. Eval
      cases before and after (fake provider); the real run waits for the owner.
- [x] **B2 W1**: `draft-post` takes a profile; one writer agent per profile in the registry with the same cached
      prefix; checks from `platforms.json` (limit, visible before "more" as advice on LinkedIn); 3 versions per
      platform from one idea.
- [x] **B3 W2**: the writer reads the top voice notes (newest first, weight by age) and tier 0 corrections after the
      cached prefix; the founder's voice beats the skill; `classify-edits` writes notes through A1's RPC; outside text
      never becomes a note.
- [ ] **B4 W3**: `write_video_brief` (called by A2's rule before `buildVideo`), `write_caption` per platform (hashtags
      only here, per profile max), YouTube title + description, `write_slides` (5–10 slides, hook first, CTA last,
      no invented numbers); a unit test per kind and one fake-provider run end to end.

## Notes

- **B0** (`dba2d93`): P2's `VideoBrief` moved into `lib/cmo/writer/types.ts`; `lib/departments/studio/types.ts`
  re-exports it, so every P2 import still works. The brief gained `cta` (default empty, older briefs parse) and the
  Director's prompt reads it (one line in `video.ts`).
- **B1**: the No AI Slop skill is ~1,730 words (principles, words, patterns and a hand-over checklist from
  `eval.md`; its chat questions, output format and scoring left out). `x_writer` and the checker carry it in their
  system prompt (cached), sales' reply prompt too; CMO chat lists it and is told to read it before writing text
  that goes out (its prompt stays a fixed string). MCP's `get_check_rubric` now says "No links and no hashtags"
  (`steps.ts`), the same rule `checkPost` runs. No e2e or check copied the fake drafts; only `draft-post.ts` had them.
- **B1 eval, fake provider** (`cmo:eval --provider fake --job w2`, with a new code-only `style-N` result per
  version from `eval/style.ts`, eval only): before 24/36 outputs passed (every fixture's versions 2 and 3 showed
  `faux_insight`/`colon_reveal`), after 36/36; compare: BETTER, 12 better, 0 worse, McNemar p = 0.0005. The real
  run (`cmo:eval --provider anthropic --yes`, before and after) waits for the owner's go-ahead (plan §6).
- **Writer core** (`f333ef2`): `lib/cmo/writer/` (`prompts.ts`, `context.ts`, `checks.ts`, `draft.ts`): one fixed
  system prompt per kind, the data after it (profile, founder's rules, voice notes, documents, research, brief),
  code checks per kind and profile, and `createWriter().draft()` (write, checks, optional review, one fix, checks).
- **B2**: `WriterProfile` is A0's `PlatformProfile`. `draft-post` drafts for the due item's profile (no item or an
  unknown platform: X, since `cmo_save_draft` makes an X item without one), with `POST_WRITERS` (`x_writer`,
  `threads_writer`, `linkedin_writer`) on one shared system prompt; the `<platform>` block comes first in the prompt
  and MCP's precheck reads the profile back from it (`profileFromPrompt`), so a Threads answer is checked against
  500, not 280. LinkedIn's "more" cut is advice for the fix round (`moreAdvice`), never a drop. Recent posts in the
  prompt are the same platform's. Eval: `w2-threads` and `w2-linkedin` (fake 36/36 each).
- **B3**: the writer's prompt reads, after the `<platform>` block, the founder's rules (tier 0), then up to 12 voice
  notes from `voice_notes_for` (store `voiceNotes`), weightiest (newest) first, each with its platform and weight,
  then documents, lessons and the other notes; the general memories leave voice-note rows out (`source_outcome` set),
  so no note is read twice. The checker reads the rules and voice too, and treats a pattern the founder uses as their
  voice. The system prompt says the founder's voice beats No AI Slop; it is the same for every founder and platform.
  `classify-edits` is unchanged: A1's `cmo_draft_outcomes_learn` trigger writes the note when the edit is labelled,
  and only SQL writes notes, from the founder's own words, so outside text never becomes one.
- `writer.check.ts` holds B's asserts; it runs in `check:contracts` once A adds it (request in `A.md`).

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)

- [from A → B] `postProfile` in `draft-post.ts` reads `profileOf(item.platform)`, but the calendar holds labels ("X",
  "Threads", "LinkedIn"): `profileOf("LinkedIn")` is null, so a LinkedIn item would be drafted as an X post. Use
  `profileOf(profileIdOf(platform) ?? "x")` (`lib/cmo/platforms.ts`, A1; same map as SQL's `platform_profile_id`).
  B3: voice notes need no write from `classify-edits` (labeling the edit writes the note); read them with
  `voice_notes_for` (A.md "A1: what B and C build on").
  - **Done** in the B3 commit: `postProfile` resolves labels with `profileIdOf` (asserted for "X", "Threads",
    "LinkedIn", "Twitter"); notes are read with `voice_notes_for`; `classify-edits` unchanged.

- [from A → B] **B4 run contract** (A2, details in A.md "A2: Writer's orders"): add `write_video_brief`, `write_caption`
  (and `write_slides`) to `CmoJobKind`/`CMO_JOB_KINDS` and to `JOBS` in `runner.ts` with your jobs (go ahead and edit
  those lines; the registry and SQL prices are in, so `capabilities.check` holds once they are listed). The brief job
  reads `run.input {idea, reason, seconds, aspect, platform}` and returns `{ brief: VideoBrief, reason }`; the caption
  job reads `run.input {clip_ids, profiles}` (profile ids) and saves each caption with `cmo_save_caption` (title only
  for `youtube`; hashtags joined into the text), returning `{ reason }`. `VideoSource.deliverableId` cannot be filled:
  the card is raised before any deliverable exists. Please key it by the edit (`clipId`).

