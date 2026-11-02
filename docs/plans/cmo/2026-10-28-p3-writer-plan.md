# P3: Writer for every platform, in the founder's voice

> **For agentic workers:** §2 says *what* ships, §5 the tasks. Three sessions build it on branch **`cmo-p3`** (PR into
> `cmo-build`). Each session's numbered todo list, owned paths and order are in
> [`2026-10-28-p3-sessions/`](2026-10-28-p3-sessions/): read `README.md` there, then your own file. Build nothing
> before your Task 0 is done; nobody builds on a contract before it is pushed.

## 0. Scope

Phase 3 of [`2026-10-28-backend-roadmap.md`](2026-10-28-backend-roadmap.md) (on branch `cmo-p2`). It builds four
backend phases from [`writer.md`](../../architecture/writer.md) §10: **W0** (No AI Slop as guidance + post rules),
**W1** (platform profiles; Threads and LinkedIn posts), **W2** (voice learned into memory), **W3** (words for Studio:
captions, YouTube title and description, video brief, slide text). After it: 12 of 28 backend phases (≈ 43%).

**Status: draft, written early (owner, 2026-10-28).** It was written while P2 was being built. Before sessions start,
the planner merges `cmo-build` (with P2) into `cmo-p3` and refreshes §3 from what P2 actually built. W0–W2 do not
depend on P2 and could start earlier; W3 needs P2's video brief and shorts.

Not in this phase: posting at a time (P4; Threads and LinkedIn stay "copy and open" until then), X threads and long
drafts (W4, P6), slideshows themselves (S3, P5; this phase only adds the `write_slides` capability they will call).

## 1. Goal and decisions

**Goal:** one idea from the week plan becomes posts for X, Threads and LinkedIn, each fitted to its platform, in the
founder's current voice; every video and short gets its captions per platform, and a long video its YouTube title and
description; Studio gets its video brief from Writer instead of the brain writing it inline.

**Decisions already made (owner, 2026-10-26 → 10-27, `writer.md` §11):**
- No AI Slop is **guidance in a skill**, never a code rule and never a gate that drops a draft.
- **No links and no hashtags in posts.** Hashtags only on video captions.
- Voice is **learned into memory** from approvals and edits, newer notes outweigh older ones; no fixed profile, no
  writing samples at onboarding, no fine-tuning.
- Studio's Director writes the long-take script; Writer writes the brief before and the captions after.
- Platform differences are data (`packages/contracts/platforms.json`); the prompt stays stable for the prompt cache.

## 2. What ships

| # | Feature | The founder sees | Done when |
|---|---|---|---|
| F1 | No AI Slop guidance | drafts with fewer stock patterns | `lib/cmo/skills/no-ai-slop.md` (MIT notice) is read by `x_writer`, the checker, `sales` and CMO chat; `x-writing.md` no longer teaches binary contrast, colon reveal or recap endings; fake drafts no longer open with "Most founders skip this:" |
| F2 | Post rules in code | a post with a link or a hashtag never reaches a card | `check-post.ts` refuses links and hashtags in posts (video captions keep their own limits) |
| F3 | Platform profiles | — (data) | `packages/contracts/platforms.json` + JSON schema (limit, visible before "more", tone, hashtags allowed, links allowed) for X, Threads, LinkedIn, Instagram caption, TikTok caption, YouTube; `check:contracts` validates it; Python and TS read the same file |
| F4 | Threads and LinkedIn posts | the week plan has Threads and LinkedIn items; their cards show the platform's limit and preview | `plan_week` may plan them (strategy decides); `draft-post` drafts per profile; checks per profile; the card's "post" action is copy + open (Threads web intent, LinkedIn copy then open) until P4 |
| F5 | Voice memory | Library → Voice lists what the CMO learned about how they write; they can delete a note | approvals as is (similarity ≥ 0.95), edits (final text + edit mode) and skip reasons become voice notes in `cmo_memories` (topic `post`); newer notes weigh more and old ones expire; the writer reads the top notes first |
| F6 | Corrections from repeated edits | a correction card on Sunday ("You keep cutting the last line. Stop adding a summary?") | an edit mode repeated 3 times in 2 weeks raises a `correction` card; approved → tier 0 memory read first |
| F7 | Video brief | — (Studio gets a better brief) | `write_video_brief` (angle, 3 hooks, key points, CTA, seconds, aspect) feeds P2's `buildVideo(brief)`; the brain no longer writes the brief inline |
| F8 | Captions and YouTube text | the shorts batch card and the finished video card show captions per platform, editable | `write_caption` per platform profile for each `video` and `short` deliverable → `caption` deliverables; YouTube title (≤ 100) + description (≤ 5,000) for long videos; hashtags only here |
| F9 | Slide text capability | — | `write_slides` (5–10 slides, hook first, one idea each, CTA last) registered and tested; S3 (P5) calls it |
| F10 | Evals and acceptance | — | eval cases per platform and kind in `lib/cmo/jobs/eval`; approve-as-is rate and edit modes measured before and after F1; a local run with fake providers: plan → X + Threads + LinkedIn drafts → approve/edit → voice notes → finished video → captions |

## 3. What exists (refreshed 2026-10-29: `cmo-build` at `fefe493`, P2 merged as #124, merged into `cmo-p3` at `b3d17e8`)

The list below is the state P3 started from: the writer as wave 1 left it, then what P2 actually built.

- Agents: `lib/cmo/agents/registry.ts` (`x_writer`, `writer`, `director`, `checker`).
- X draft job `lib/cmo/jobs/draft-post.ts` (197 lines): 3 versions with an angle each, checker on the other
  provider, one fix, card with alternates; the fake drafts at line 57 open with "Most founders skip this:".
- Code checks `lib/cmo/jobs/check-post.ts` (30 lines): `X_LIMIT = 280`, words to avoid, unknown numbers, "more than
  two hashtags" (to become: none in posts).
- Skills `lib/cmo/skills/` (`x-writing.md` lines 13, 16, 23 teach the patterns to remove; `short-video.md` has
  captions per platform), generated index `index.gen.ts`, MIT notices in `skills/LICENSE.md` and
  `THIRD_PARTY_NOTICES.md`. The No AI Slop source is the attached repo `marcus-legia/no-ai-slop`
  (`skills/no-ai-slop/`, MIT).
- Learning: `cmo_draft_outcomes`, `edit-taxonomy.ts` (8 edit modes), `classify-edits.ts`, `summarize-memory.ts`,
  `review-week.ts`; `cmo_memories` has `kind`, `topic` (`post` exists), `importance` 1–3, `expires_at`,
  `source_run`.
- Wave 1 B0 built corrections (`approvals.kind` allows `correction`, `ref_kind` `correction`).
- `content_items.platform` is free text (1–20 characters); `deliverables.kind` already allows `caption`.
- Screens: `writer` (`drafts` live, `voice` not), `library` (`voice`, `skills` not live).
- P2 as built (#124):
  - Studio adapter `lib/departments/studio/` (`types.ts`, `adapter.ts`, `video.ts`, `shorts/`): `plan`, `decide`,
    `buildVideo(brief)`, `cutShorts`, `markFinished`, `renderShort`, with callers per entry (`STUDIO_ACCESS`).
  - The brief type `VideoBriefSchema` lived in the adapter's `types.ts`: objective, angle, up to 3 hooks, up to 6 key
    points, seconds 5–90, aspect, voice; no call to action. `briefRequest` turns it into `create_video` input for the
    Director. The brain wrote it inline from the plan's video item (`briefOf` in `jobs/studio-orders.ts`).
  - Studio orders `build_video`, `cut_shorts` (`work_orders`), run by `jobs/studio-orders.ts` under the founder's
    brain JWT; priced steps stored in `studio_steps` behind `script`/`price` cards; `finished_video` and
    `shorts_batch` cards (`short_batches`, `shorts`); finished state `editor_projects.finished_at` + `finished_hash`;
    approved shorts become `short` deliverables.
  - `packages/contracts/capabilities.json` lists the CMO jobs, the Studio entries and the priced MCP tools, checked by
    `lib/cmo/capabilities.check.ts`.
- What P3 changed against this list is in each session's notes (`2026-10-28-p3-sessions/`): the brief moved to
  `lib/cmo/writer/types.ts` (Studio re-exports it) and gained a call to action (B0).

## 4. Global constraints

- Every write through an ownership-checking RPC; a pgTAP test per migration and per transition; regenerate
  `supabase/schema/current.sql`. **Migration prefix for this phase: `20261229`.**
- No AI Slop never drops a draft; code checks only for facts and product rules (length, words to avoid, numbers in the
  documents, no links and no hashtags in posts).
- Outside text (competitor posts, research) stays data (`lib/cmo/untrusted.ts`).
- The prompt stays stable: platform and founder differences go in as data after the cached prefix.
- English in all user-facing text; no model names; the brain never posts.
- Copy the No AI Slop text only with its MIT notice; leave out its chat questions, output format and scoring.

## 5. Tasks

| Task | Session | What | Waits on |
|---|---|---|---|
| **A0** | A | **Contracts first:** `packages/contracts/platforms.json` + `platforms.schema.json` + its check; migration skeleton (`cmo_draft_outcomes.platform`, voice-note columns or view, deliverable link caption → video/short); screen types for `writer.voice`, `library.voice`, `library.skills` | — |
| **B0** | B | **Contracts first:** `lib/cmo/writer/types.ts`: one writer interface `draft(kind, profile, brief, context)` for post, caption, YouTube text, video brief, slides; the video brief type shared with P2's adapter | — |
| A1 | A | Voice notes in SQL: RPCs that write a note from an outcome, weigh by age, expire, delete by the founder; correction trigger (an edit mode 3 times in 14 days → `correction` card) | A0 |
| A2 | A | `plan_week` plans Threads and LinkedIn items; order kinds `write_caption`, `write_video_brief`, `write_slides` in `capabilities.json`; event rules: finished video / shorts batch built → `write_caption` orders | A0, B0 |
| A3 | A | Loaders: `writer.voice`, `library.voice`, `library.skills`; per-platform drafts in `writer.drafts`; flip `live` | A1 |
| A4 | A | Acceptance (F10) with screenshots of Writer, Library Voice and a shorts card with captions at 1440 and 390 | all |
| B1 | B | W0: `no-ai-slop.md` skill + notices + index; `x-writing.md` fix; fake drafts fix; `check-post.ts` no links, no hashtags in posts; eval cases before/after | B0 |
| B2 | B | W1: `draft-post` per profile (one writer agent per profile in the registry), checks per profile from `platforms.json` | A0, B1 |
| B3 | B | W2: the writer reads voice notes (top N, newer first, founder's voice beats the skill) and tier 0 corrections; `classify-edits` writes notes through A1's RPC | A1 |
| B4 | B | W3: `write_video_brief` (the brain's video order calls it before `buildVideo`), `write_caption` per profile (hashtags allowed here only), YouTube title + description, `write_slides`; tests per kind | B0, A2 |
| C0 | C | Card bodies on A0's types with fixtures: Threads and LinkedIn post cards (limit, visible-before-more marker, copy + open), caption editor inside the shorts batch and finished video cards | A0 |
| C1 | C | Writer page per platform (tabs or filter), Library → Voice (notes, delete) and Skills (read-only list) live | A3 |
| C2 | C | Correction card body (the repeated edit, before/after, approve or dismiss) | A1 |
| C3 | C | e2e on live rows: a Threads draft approved (copy + open), a voice note deleted, captions edited on a shorts card | C0–C2 |

**Milestones**
- **M1** contracts: A0 and B0 pushed and reviewed.
- **M2** posts for every platform in their voice: A1–A3, B1–B3, C0–C2.
- **M3** words for Studio and acceptance: A4, B4, C3; the planner reviews the whole PR.

## 6. Owner gates

- One real-model eval run before and after F1 (`cmo:eval --provider anthropic --yes`), only with the owner's go-ahead.

## 7. Review focus

- No AI Slop is advice: nothing in code drops a draft because of a pattern.
- No link and no hashtag reaches a post card; hashtags appear only on captions.
- Newer voice notes beat older ones; the founder can delete any note; nothing outside text becomes a voice note.
- The video brief is one type shared by Writer and the Studio adapter; MCP's Studio tools are unchanged.
- Prompt prefix unchanged across platforms (cache hit rate in the eval log).
