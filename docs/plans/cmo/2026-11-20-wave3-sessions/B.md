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

### - [x] B2. DM drafts and nudges (after B1)
For DM-ready people, draft one DM (short, refers to the public reply, says the product is theirs, asks before linking),
at most 20 a day per founder.
For replied people with no answer after 4 days, draft one nudge. Saved by A3's RPCs; founder sends. Eval cases.

### - [x] B3. Posts from the Library (after A2, A4)
`plan_week` picks topics from the top Library themes of the last 14 days (and the Post plan's channels and rhythm);
each planned post carries `PostSource[]`. `post_draft` writes from those sources and stores them on the content
item. No Library entries: no automatic post (the week plan says so in one line). A chat brief still drafts.
Eval: every draft cites at least one source; no invented numbers.
*Done:* `jobs/library-sources.ts`; an item planned before sources (or while `cmo_plan_week` drops them, A request)
takes the Library theme closest to its idea. The onboarding plan waits up to 6 minutes for the free scan's Library.

### - [x] B4. Onboarding writes documents v2; voice in prompts (after A4)
Onboarding asks "who do you sell to?" while it reads the site (the answer goes into the Strategy and the first
scan), and fills `strategy.where_they_ask` and `this_week`, `brand.look` (colours, font, logo from the site),
`post_plan` (channels default X, LinkedIn, Threads). Reply, DM, nudge and post prompts read `brand.voice_samples`,
`intro_line` and `avoid`. Update the document eval.

### - [x] B5. Scan cadence and Today (after A5)
`loops.ts`: a `sales_scan` loop on `sales_settings.cadence` for paid accounts, independent of the week plan (drop the
`dueSales` condition). `today.ts`: a `hot_lead` reason (Strong match or thread under 24 h) and a `follow_up` reason
above posts; the "nothing posted for N days" reason drops below them. Checks updated.

### - [x] B6. Follow-up re-reads (after A3)
`reply-outcomes` uses `reply_url` when present, sets `person_status = answered_back` when someone answered the
founder, and adds Threads and Facebook groups where the social reader returns comments; where it cannot, it leaves
the status to the founder. Check updated.

### - [x] B7. Research chat (after A6)
The CMO chat scoped to Research gets a `find_competitors` tool: it searches Reddit, HN and the web through the same
Lurk reader Sales uses, returns up to 5 names people mention that the founder does not have yet, each with one line of
why and where, and adds one only when the founder presses Add (`competitor_add`). Included in the plan (no price).
Eval with the fake reader.

### - [x] B8. Weekly report and the strong-match push (after A5)
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
- **From A (A5, A6, ready):** `SalesSettings.cadence` (`ScanCadence`: `mwf` default, `weekdays`, `monday`;
  `SCAN_CADENCES` in `jobs/types.ts`) comes from `store.salesSettings` for B5's loop. B7's Research chat adds a
  competitor under the founder's session with `competitor_add(p_url, p_name, p_logo_url, p_price, p_offer, p_via =>
  'chat')`.
- **From A (your B6, B2 and B3 asks, ready):** `cmo_reply_outcomes_due` returns Threads too and gives
  `coalesce(reply_url, outcome_url)`. Answered back: keep calling `store.markAnsweredBack` as `reply-outcomes` does
  (a person on a replied card is already `replied` through the trigger, so `found` never needs it); I did not add a
  second path in `saveReplyOutcome`. `store.nudgesDue(userId, limit = 10): NudgeDue[]` (`jobs/types.ts`) →
  `cmo_nudges_due`; `LoopState.nudgesDue` is declared in `loops.ts` (one optional field, as you asked) and filled in
  `schedule.ts`; the memory twin reads `people` (set `repliedAt`/`status` in your checks). **`PlanItem.sources?:
  PostSource[]` is added** (`jobs/types.ts`; do not add it again): `cmo_plan_week` keeps the valid ones in
  `body.sources`, `cmo_save_draft` keeps the draft's own or else the item's, both dropping invalid ones (≤ 5, the
  founder's own opportunity, summary 1–200, Sales platform, community ≤ 120). The memory store does the same (its
  opportunity id is the url).
- **From A (A4 heads-up, owner's call 2026-11-19):** A4 lands as one commit that renames the document kind
  `content_strategy` → `post_plan` and moves `voice` / `avoid` out of Strategy into a new `brand` kind, **in every
  file that reads them, yours included** (mechanical edits only). Commit what you have and pull right after A4's
  "Wave 3 A4" commit appears; avoid editing `content_strategy` / `strategy.voice` / `strategy.avoid` code until then.
- **From A (A4, landed in "Wave 3 A4", pull now):** kinds are `product, strategy, competitors, post_plan, brand`
  (`DOCUMENT_KINDS`; `content_strategy` is gone, the RPC refuses it). `StrategySchema`: `icp, pains, where_they_ask,
  positioning, value_props, this_week`. `PostPlanSchema`: `topics: string[], channels: ("x"|"linkedin"|"threads")[],
  rhythm`. `BrandSchema`: `voice, voice_samples (≤ 5, 600 chars each), intro_line, avoid, look { logo_url, colors (#hex,
  ≤ 4), font, screenshots, image_styles (≤ 2) }`. I changed your readers mechanically: `avoidList` reads
  `docs.brand.avoid`, `documentsBlock` includes brand and post_plan, plan-week's fallback ideas come from
  `post_plan.topics`, niche research reads topics, onboarding (`generate.ts`) writes five documents (fake updated,
  prompt says five and leaves samples/screenshots empty), onboarding steps are `…, post_plan, brand`. **B4 still owns**
  the onboarding prompt's quality (fit test, look from the site, where they ask) and putting `voice_samples` /
  `intro_line` into the writer and reply prompts. The onboarding answers now set `post_plan.channels` (SQL).
- **From A (your sells_to ask, ready):** `cmo_onboarding_answers({ sells_to })` (string, 1–160 chars after tidying
  spaces; error "Say who you sell to in 1 to 160 characters."), stored on `profiles.sells_to` (readable by the
  founder's session). `cmo_apply_onboarding_answers` writes it into the newest Strategy's `icp` as a `user` version when
  the founder answers now, or when the Strategy is still the agent's; a later founder edit is never overwritten.
