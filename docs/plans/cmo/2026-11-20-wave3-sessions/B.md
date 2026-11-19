# Session B — jobs and prompts

Plan: [`../2026-11-20-wave3-plan.md`](../2026-11-20-wave3-plan.md). Branch `claude/launch`. Every prompt that writes
for a reader embeds `NO_AI_SLOP` and is listed in `lib/cmo/skills/no-ai-slop.check.ts`; each job change gets an eval
case with the fake provider (`npm run cmo:eval -- --provider fake`).

**Owns:** `apps/web/lib/cmo/jobs/sales-scan.ts`, `sales-reply-drafts.ts`, `plan-week.ts`, `draft-post.ts`,
`reply-outcomes.ts`, `lib/cmo/onboard.ts`, `lib/cmo/loops.ts`, `lib/cmo/schedule.ts`, `lib/cmo/today.ts`
(+ checks), prompts under `lib/cmo/skills/` used by these jobs, `jobs/eval/cases/*`.

## Tasks

### - [x] B1. The scan fills the Library and the reach check (after A2, A3)
In the scoring step, also return per thread: a one-line summary of the post (never its title), the theme it belongs
to (reuse an existing theme name when it fits, else a new short name), and the reach check from the post and thread
only (buyer in their own words, wants now, warm, fresh, a way to reach them: DMs allowed by the platform and the
community's rules; an email only when it is in the post or thread, or on the business site the post links).
Save via `cmo_save_library` and `cmo_save_reach`. No profile reads. Eval: summary is not the title; a vendor author is
not a buyer; HN is never DM ready.

### - [ ] B2. DM drafts and nudges (after B1)
For DM-ready people, draft one DM (short, refers to the public reply, says the product is theirs, asks before linking),
at most 20 a day per founder.
For replied people with no answer after 4 days, draft one nudge. Saved by A3's RPCs; founder sends. Eval cases.

### - [ ] B3. Posts from the Library (after A2, A4)
`plan_week` picks topics from the top Library themes of the last 14 days (and the Post plan's channels and rhythm);
each planned post carries `PostSource[]`. `post_draft` writes from those sources and stores them on the content
item. No Library entries: no automatic post (the week plan says so in one line). A chat brief still drafts.
Eval: every draft cites at least one source; no invented numbers.

### - [ ] B4. Onboarding writes documents v2; voice in prompts (after A4)
Onboarding asks "who do you sell to?" while it reads the site (the answer goes into the Strategy and the first
scan), and fills `strategy.where_they_ask` and `this_week`, `brand.look` (colours, font, logo from the site),
`post_plan` (channels default X, LinkedIn, Threads). Reply, DM, nudge and post prompts read `brand.voice_samples`,
`intro_line` and `avoid`. Update the document eval.

### - [ ] B5. Scan cadence and Today (after A5)
`loops.ts`: a `sales_scan` loop on `sales_settings.cadence` for paid accounts, independent of the week plan (drop the
`dueSales` condition). `today.ts`: a `hot_lead` reason (Strong match or thread under 24 h) and a `follow_up` reason
above posts; the "nothing posted for N days" reason drops below them. Checks updated.

### - [ ] B6. Follow-up re-reads (after A3)
`reply-outcomes` uses `reply_url` when present, sets `person_status = answered_back` when someone answered the
founder, and adds Threads and Facebook groups where the social reader returns comments; where it cannot, it leaves
the status to the founder. Check updated.

### - [ ] B7. Research chat (after A6)
The CMO chat scoped to Research gets a `find_competitors` tool: it searches Reddit, HN and the web through the same
Lurk reader Sales uses, returns up to 5 names people mention that the founder does not have yet, each with one line of
why and where, and adds one only when the founder presses Add (`competitor_add`). Included in the plan (no price).
Eval with the fake reader.

### - [ ] B8. Weekly report and the strong-match push (after A5)
Mondays: the weekly report replaces that day's morning email (found, replied, answered back, signed up; what worked;
the theme people mentioned most; posts that went out), logged as `weekly`. Right after a scan: one push for a Strong
match in a thread under a day old (once per card, logged as `push`). Template through `no-ai-slop`; checks.

## Requests

- **From A (A1, ready):** `lib/cmo/library.ts` (`LibraryEntry`, `LibraryTheme`, their zod schemas, `LIBRARY_LIMITS`:
  summary ≤ 200 chars, ≤ 4 quotes of ≤ 280 chars, theme name ≤ 80) and `lib/cmo/reach.ts` (`ReachCheck`,
  `ReachCheckSchema`, `reachLevel(check)`, `isFresh(postedAt)`, `platformHasDms(platform)`, `DM_DRAFTS_PER_DAY = 20`,
  `NUDGE_AFTER_DAYS = 4`, `PERSON_STATUSES`). **`ReachCheck` has one field more than the plan: `asksForTools`**
  (the post asks for tools; stands in for `warm` for a DM, never for an email); B1 fills it. `PostSource` is in
  `lib/cmo/jobs/types.ts`. The tables and RPCs come with A2/A3.
- **From A (A2, ready):** `store.saveLibrary(userId, runId, items: LibrarySaveItem[])` → `cmo_save_library(p_user,
  p_run, p_items)`, items `{ url, theme, summary, quotes }` as you asked (keyed by url; unknown url or empty summary
  skipped; the run must be that user's `sales_scan`; ≤ 50 items; quotes other than pain/evidence dropped, ≤ 4 kept).
  `store.libraryThemeNames(userId, limit = 30)` → `cmo_library_theme_names`. **A post's sources go in
  `content_items.body.sources: PostSource[]`**: `my_library` counts "used in posts" from that key, so B3 must write it
  there. `library_delete_entry(p_url)` (service role) drops a link's lines for every founder.
- **From A (A3, ready):** `store.saveReach(userId, runId, items: ReachSaveItem[])` (`lib/cmo/reach.ts`:
  `{ url, level, reach, dm? }`) → `cmo_save_reach`; the run may be the user's `sales_scan` or `sales_reply_drafts`.
  SQL recomputes the level from the checks (your `level` is ignored), forces `dmAllowed = false` on HN, keeps `dm`
  only for a DM-ready person without a DM yet, at most 20 a day. `store.saveNudge(userId, runId, opportunityId, text)`
  (any run of that user; only `person_status = 'replied'`, `replied_at` > 4 days ago, no nudge yet) and
  `store.markAnsweredBack(userId, opportunityId)` (replied → answered_back only) for B6. `SubredditRule.no_dms` is
  stored by `saveSubredditRule`. Columns on `opportunities`: `person_status, status_at, reply_url, replied_at,
  reach_level, reach, dm_draft, dm_drafted_at, nudge_draft, nudge_drafted_at`. B6: `reply_url` is also copied to
  `cmo_draft_outcomes.outcome_url`, so `cmo_reply_outcomes_due` already sees it.
- **From A (your B3 and B5 asks, ready):** `store.libraryTopThemes(userId, days = 14, limit = 5)` →
  `cmo_library_top_themes` (`LibraryTopTheme` in `lib/cmo/library.ts`); memory twin uses the url as the id.
  `today-input.ts` now fills `score`, `postedAt` and `followUps` (`approvalId` is null: a nudge is a draft on the
  person, not a card).
