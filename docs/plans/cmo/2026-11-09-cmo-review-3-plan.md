# CMO review 3: a daily loop that learns the founder, then the script where they work

Sources:
- The Okara study of 2026-11-09: `opencmo-internal` PR #8, `docs/specs/2026-11-09-hoc-okara-cmo.md` and its five
  reports (Okara's client bundle read statically; behaviour learned, no code, strings or prompts copied).
- The owner's conversation of 2026-11-10, which took the decisions in §2.
- The first draft of this plan (2026-11-09, PR #184): the script in the editor and on the phone. It is now phase 2.
- [`docs/research/agents/2026-11-09-weekly-approvals.md`](../../research/agents/2026-11-09-weekly-approvals.md)
  (C4: fewer cards a week).

Branch: **`claude/okara-spec-opencmo-b7qlx2`**, one PR to `main`. It already holds `cmo-review-3` merged in, so
#184 is replaced by this PR. Sessions: [`2026-11-09-cmo-review-3-sessions/`](2026-11-09-cmo-review-3-sessions/).

## 1. Why

Okara sells the same loop we do (website → documents → drafts → approval → posting) and packages it better in three
places. In each, our machinery underneath is stronger:

1. **A day, not a queue.** Okara gives the founder a short list for today, with "N of M done", and pushes a platform
   that has been silent for days to the top. We show 15–20 cards a week as one queue. A post also needs two cards
   (the words, then the time), which the C4 report calls our biggest waste.
2. **The founder sees the CMO learn.** Okara has the founder rate five drafts during onboarding, turns the ratings
   into a few rules, and shows the voice as a page with history and Undo. We label edits with Haiku in the
   background, and a rule appears only after the same label shows up three times in 14 days
   (`correction_from_edits`). A skip reason is free text that no rule ever reads.
3. **Value before the paywall.** Okara's free plan does the research, the documents and the plan. We send a new
   account with 0 credits to `/app/billing?start=1` before the CMO does anything (`apps/web/app/app/page.tsx:37-44`),
   though the first run costs us a few cents.

What we keep and say louder: nothing goes out without the founder (Okara has an X autopilot), Sales cites evidence
from the thread, invented numbers are blocked in code, the founder's real video, and MCP inbox mode.

## 2. Decisions (owner, 2026-11-10)

- **The first run is free.** It covers onboarding, the four documents, the first week's plan and the first set of
  three X drafts. The paywall moves to the first action that sends something out or costs credits again: approving,
  scheduling or "I posted it", the CMO chat, a Sales scan, planning again and reading the site again. This replaces
  "paid first, no free trial" (2026-11-08) for the first run only. MCP stays paid only.
- **A post card carries its time.** Approving a post approves its words, its time and its account at once. The
  separate `schedule` card stays only when the approved time can no longer be used, for a failure and Retry, and for
  video deliverables (shorts, slideshows, the founder's video), which this plan does not change.
- **Order of work:** groups 1, 2 and 3 (phase 1, this plan's §3–§5), then group 4 (phase 2, §8: the script items of
  the first draft). Phase 2 starts only after phase 1 has been reviewed.
- **Who does what:** this planning session writes the plan and reviews; it does not implement. Two build sessions
  implement phase 1 (§6).
- **Every finished group runs `/code-review`** (rule in §7).

## 3. Group 1: the day ("Today")

### 1.1 Today, a short list worked out on the server

- **What it is.** A block at the top of the Dashboard (`components/dashboard/Dashboard.tsx`), above the full
  `ApprovalQueue`, which stays below it as "Everything waiting". It shows at most 5 rows, the line
  "N of M done today", and "N more waiting" when it cuts the list.
- **No new table.** `lib/cmo/today.ts` (new) has a pure `buildToday(input)` that works from data we already have:
  - waiting `approvals` (each row opens the card in place, with the actions it has today);
  - today's slots that failed or need the founder (`scheduleSlots`, as `outToday` reads them in
    `lib/screens/load.ts:250`);
  - **days silent** per platform the founder posts on: today minus the last post (`published_items`, with
    "I posted it" counted). At 2 days or more the row is "High", at 7 or more "Critical". The row's action is the
    waiting post for that platform, or "Ask your CMO for a post", which opens the chat with the request filled in
    (the chat shows its price card as usual);
  - **setup that blocks a post**, only when it really blocks one: "Connect X so tomorrow's post can go out" appears
    only when the publish adapter is configured (`lib/departments/publish/adapter.ts:20`). Otherwise posting by
    intent works and there is nothing to connect;
  - **first-run rows** (group 3): "Ready to read: your marketing strategy", then "Rate your first drafts" (2.2).
- **Ranking**, deterministic, with no model call:
  1. a failed post still inside its window;
  2. Critical silence;
  3. a card that expires today;
  4. first-run rows;
  5. High silence;
  6. the oldest waiting card, at most one per kind until every kind has had a row.
- **"Done".** A row is done when its card was decided today, in the founder's time zone. "N of M" counts the rows
  decided today plus the rows still open. Nothing is kept in the browser.
- **Contract.** A `today` block in the dashboard screen: schema in `lib/screens/dashboard.ts`, a loader in
  `lib/screens/load.ts`, the `live` and `release` lists in `lib/screens/registry.ts:54-55`, and a fixture in
  `lib/screens/fixtures/dashboard.ts`.
- **Copy** goes through no-ai-slop. No urgency that is not true: "X: nothing posted for 3 days", never a countdown.
- **Not Okara's way:** Okara keeps this list in localStorage, so it is lost on another device; ours is read from the
  server.
- **Check:**
  - unit tests of `buildToday`: ranking, the cap, silence thresholds, the time zone at midnight, the connection row
    hidden when publishing is off;
  - e2e at 1280 px and 390 px: approve the top row, and the count reads "1 of N done";
  - screenshots of both widths, looked at.

### 1.2 One card for a post: the words and the time

- **Today.** `cmo_decide_post` approves the words. A trigger makes the `post` deliverable `decided`, and
  `schedule_follow_deliverable` calls `schedule_propose`, which inserts a `proposed` slot and raises a second card
  (`schedule`) (`supabase/schema/current.sql:12065` and `:12298`).
- **New.**
  - When a post card is raised, the post gets a proposed time: `schedule_pick_time` per platform, stored on the
    content item (for example `body.proposed`, holding `{platform, at, account_id, mode}`).
  - The time, the account and the mode are part of the card's snapshot, so the hash covers what the founder approves.
  - The card shows "Goes out Tue 09:00 on X (@handle)" or, without an account, "Opens X to post at 09:00".
  - The card gets the actions `change_time` and `change_account`. Each refreshes the card, as `schedule_change`
    does today.
- **On approve.**
  - `schedule_propose`, for a `post` deliverable whose item holds an approved proposal, inserts the slot as
    `waiting` with that time and raises no card.
  - It still runs `schedule_ready_check` and the gap and daily-cap rules.
  - If the time has passed or no longer fits, it falls back to today's path: a `schedule` card with the line "The
    time you approved is no longer free. Pick a new one."
  - A post with an image (C3) is decided after its image is built. The same path applies, because the proposal
    lives on the item.
- **Unchanged:** Retry on a failed slot, "I posted it", video deliverables, and editing the time later on Schedule
  (`/app/schedule`, which raises a card as today).
- **The CMO chat and MCP.** `decide_card` on a post approves the time shown, and the tool says so.
- **Docs.** `docs/architecture/approval.md` and `schedule-publish.md`, and their `.html` twins.
- **Check:**
  - pgTAP:
    - an approved post gets a `waiting` slot at the shown time and no schedule card;
    - a time that is gone falls back to one schedule card;
    - a changed time changes the hash, so an approve of the old card is refused;
    - another user's card: not found;
  - e2e: approve a post and see it on Schedule at that time.

### 1.3 Today at the top of the morning email

- `lib/cmo/digest.ts` takes the same rows as `buildToday`: the top 3 rows and "N more waiting". It stays a template
  with no model call, and its links only open the card (mail scanners open links), as today.
- **Check:** `digest.check.ts` cases for the order of the rows, the cut, and an empty day.

## 4. Group 2: the founder sees the CMO learn

### 2.1 A reason picked on every draft

- **Skip.** "Skip with reason" (`components/cards/ApprovalCard.tsx:61`, `:505-510`) gets chips:
  - Too salesy (`TOO_SALESY`);
  - Doesn't sound like me (`WRONG_VOICE`);
  - Made something up (`INVENTED_CLAIM`);
  - Too long (`TOO_LONG`);
  - Weak first line (`HOOK_REWRITTEN`);
  - Off topic (`OFF_TOPIC`);
  - Something else, which shows the free text box that exists today.
- **An edited approve.** When the approved text is not one of the versions as written (similarity below
  `cmo_as_written()`), the card shows the same chips once, optional, as "What did you fix?". Approve never waits for
  an answer.
- **Data.**
  - `cmo_draft_outcomes` gets `reason_code` (the chips' values) and `labelled_by` (`founder` | `model`).
  - A chip that matches an `EDIT_MODES` label sets `edit_mode` with `labelled_by = 'founder'` and
    `classified_at = now()`, so `classify-edits.ts` skips it. Haiku labels only edits that have no chip.
  - `OFF_TOPIC` and "Something else" go to feedback memory for the planner, as the skip reason does today.
- **Faster rules.** `correction_from_edits` counts founder-labelled skips as well as approves. Two founder labels of
  the same kind are enough (the model's labels still need 3). The 14-day window stays.
- **The decide payload.** `reason_code` is checked against the list in SQL. The zod schema of the approvals route and
  `components/cards/decide.ts` get the new field.
- **Check:**
  - pgTAP: each chip is stored; a founder label is not overwritten by the classifier; two founder labels propose a
    correction;
  - `jobs.check.ts`: the classifier skips founder-labelled rows.

### 2.2 "Rate your first drafts"

- **Entry.** A Today row (1.1) once the first `post_draft` card of an account exists and the account has no rating
  round yet. It opens a sheet with the 3 versions of the first post, plus versions of other waiting post cards up to
  5 in all.
- **For each version:** 👍 or 👎, the chips of 2.1 on 👎, and an optional note of up to 200 characters. Rating is
  not deciding: the post card stays waiting.
- **Data.**
  - A new table `cmo_draft_ratings`: user, item, version, verdict, `reason_code`, note, round. It has RLS, explicit
    grants, and a pgTAP test.
  - An RPC `cmo_rate_drafts(p_ratings jsonb)` checks ownership and limits (at most 5 rows a round, 1 round a day) and
    queues the job `distill_ratings`.
- **The job `distill_ratings`.**
  - Haiku, through the registry (`lib/cmo/agents/registry.ts`).
  - Price 0: the cost is ours, like `classify_edits`.
  - The prompt embeds `NO_AI_SLOP` and is added to `lib/cmo/skills/no-ai-slop.check.ts`.
  - It writes at most 5 rules. Each rule is under 200 characters, in the founder's words, and grounded in the ratings
    (a rule no rating supports is dropped by a code check).
  - It writes them as `cmo_corrections` with `status = 'proposed'` and `source = 'ratings'`.
  - It runs once per round, never during the 14-day count.
- **The founder's answer.** The sheet then shows "Your CMO learned:" with each rule ticked and editable, and one
  button, "Use these rules". The RPC `cmo_accept_corrections(p_ids, p_texts)` makes the ticked rules `active` in one
  transaction. No card per rule.
- **The first run.** Unpaid accounts can rate (§2: the first run is free). The distill job is part of the first run.
- **Check:**
  - pgTAP: limits, ownership, accepting a subset;
  - a `cmo:eval -- --provider fake` case: ratings with "Too salesy" twice produce a help-first rule, and a 👍-only
    round produces no rule;
  - e2e: rate 3, accept 2, and the two rules show in Library → Voice.

### 2.3 The voice as a page with history and Undo

- **Library → Voice** (`components/screens/library/LibraryScreen.tsx:103`) becomes one page in three parts:
  - **Rules**: the active corrections. Each can be edited or turned off.
  - **From your setup**: `strategy.voice` and `strategy.avoid`, linked to the Business document.
  - **Learned notes**: the voice notes, with delete, as today.
- **History.**
  - A new table `cmo_voice_events`: who changed what, with the source (Setup, You, Learned from your edits, From your
    ratings), the text before and after, and when.
  - It is written by the RPCs that change rules (`cmo_decide_correction`, `cmo_accept_corrections`, a new
    `cmo_edit_correction`) and by a trigger on `save_marketing_document` for `strategy.voice` and `avoid`.
  - **Undo** reverts the last event (`cmo_voice_undo`, owner-checked; it undoes one event only, and twice in a row
    undoes the one before).
- The founder edits rules, not the raw prompt. Okara lets founders edit the prompt itself; rules are enough for us
  and keep the Writer's prompt and NO_AI_SLOP intact.
- **Check:**
  - pgTAP: each source writes an event; Undo restores the text before; another user's event: not found;
  - e2e: edit a rule, Undo, and the rule reads as before.

## 5. Group 3: the first run is free, and onboarding shows its work

### 3.1 The free first run

- **SQL.**
  - A new `cmo_first_run_free(p_user, p_kind)` is true only for an account that is not paid (`is_paid`), for
    `plan_week` and `post_draft`, when the account has no earlier run of that kind that succeeded.
  - `cmo_enqueue` (`supabase/schema/current.sql:3929`) prices such a run at 0, and the week budget gate lets it
    through.
  - The input field `source` is not trusted for this: a founder can call `start_cmo_run` themselves, so the rule
    reads history, not input.
  - Unpaid onboarding is capped at 2 runs ever (a typo in the URL), down from 5 a day.
- **Routes and pages.**
  - `app/api/v1/cmo/onboarding/route.ts` drops `paidOrWait` for the first run.
  - `app/app/page.tsx:37-44`: an unpaid account with no documents goes to Setup, not Billing. With documents, it goes
    to the Dashboard.
  - `lib/paid-first.ts` keeps one job: the check for the paid actions below.
- **The paywall, one rule in SQL:** `cmo_require_paid(p_user)`, with its own SQLSTATE mapped to 402 and the code
  `plan_required` in `lib/api/errors.ts`. Session A calls it in:
  - `approval_decide` (approve, schedule, `change_time`);
  - `cmo_post_myself`.

  Session B calls it in:
  - the chat turn (a clear 402, not "not enough credits");
  - Sales scan;
  - `plan_week` beyond the free one;
  - onboarding again.
- **The UI answer** to a 402 `plan_required`: one sheet, `components/billing/PlanSheet.tsx` (new). It says "Pick a
  plan to approve and post. Your drafts stay here." and shows the plans from the catalogue, with no price in code.
- **Crons.** `lib/cmo/loops.ts` and `lib/cmo/schedule.ts` skip unpaid accounts (no Monday plan, no daily draft), so
  their logs show no "not enough credits" noise. The morning email still goes out with what waits.
  `purge_unpaid_accounts` (30 days) stays.
- **Copy** that must be true (CLAUDE.md, "Don't ship coming soon"): `app/page.tsx:99`, `components/landing/data.ts:130`,
  `components/landing/PricingSection.tsx:102`, `app/llms.txt/route.ts:22`, `app/app/billing/page.tsx:72`,
  `lib/pricing.ts` (the description of the free state), and the Setup comment (`SetupScreen.tsx:48`). The line:
  "Your first plan and drafts are free. Pick a plan to approve and post them."
- **Abuse.** Signup already needs a working email (check how each login method verifies before building; if one does
  not, the free run waits for a verified email). There are 2 onboarding runs per account ever, the existing route
  rate limit, and the run costs a few cents. No guest session.
- **Check:**
  - pgTAP:
    - the free run is charged 0 exactly once per kind;
    - the second `plan_week` is charged;
    - a paid account is charged as before;
    - `source` in the input changes nothing;
    - approve on an unpaid account is refused with the 402 code;
  - e2e: sign up, enter a site, see the documents, plan and drafts with no payment, press Approve, see the plan sheet.

### 3.2 Onboarding shows its work, and asks while it waits

- **Progress.** `runOnboarding` (`lib/cmo/onboard.ts:30`) writes real steps to `cmo_runs.steps`: reading your site,
  then the 4 documents one by one, then planning your week, then today's drafts. Setup reads the run over Realtime,
  or a poll every 2 s, and shows each step as it ends. Today Setup waits on one blank request
  (`SetupScreen.tsx:54`).
- **Three questions in the meantime**, all optional, with a Skip button. They disappear when the run ends:
  1. your X handle, prefilled once `product.x_handle` exists;
  2. which platforms you post on (X, Threads, LinkedIn). If the plan has not started yet, it reads the answer;
     otherwise the next plan does;
  3. how you heard about OpenCMO (a short list, plus Other).
- **Data.** The RPC `cmo_onboarding_answers(p_answers jsonb)` writes to `profiles` (handle and source) and to the
  content strategy platforms, with limits checked.
- **When it ends**, Setup goes to the Dashboard. The first Today row is "Ready to read: your marketing strategy".
- **Check:** e2e with `OPENCMO_AI_FAKE=1`: the steps appear in order, the answers are saved, and Skip works.

### 3.3 "Used by" on each document

- `components/screens/library/BusinessDocs.tsx`: under each document's title, "Used by Writer, Planner, Sales" (the
  `WHO_READS` facts in `LibraryScreen.tsx:21`), and a line: "Edit it here and every draft after uses it."
- **Check:** covered by the Library e2e.

### 3.4 One activation event

- **A new table `product_events`:**
  - columns: user, kind, platform, paid, at;
  - no client insert, no client read; RLS on with no policy; explicit grants to `service_role` only;
  - written by triggers.
- **Kinds:**
  - `onboarded` (the documents are saved);
  - `approve` (a post or reply card);
  - `schedule` (a slot made `waiting`);
  - `posted` (published or "I posted it");
  - `reply_copied` (a Sales reply marked replied).
- **The view `activation`:** per signup day, the share of accounts with a first `approve` within 24 h of
  `onboarded`, split by paid. Readable only through the service role. No analytics vendor, no third-party script,
  nothing about the founder leaves our database.
- **Triggers** sit on `approvals`, `schedule_slots` and `opportunities` as their own functions. They never edit
  session A's functions.
- **Check:** pgTAP: each kind writes once; a user can neither read nor insert; the view counts a seeded example.

## 6. Sessions

One branch, `claude/okara-spec-opencmo-b7qlx2`, one PR. Each session works its own list in order (1 before 2 or 3).
The two sessions run side by side and never touch the same file or SQL function.

| Session | Items, in order | Owns |
|---|---|---|
| **A: Post card and voice** ([`A-post-voice.md`](2026-11-09-cmo-review-3-sessions/A-post-voice.md)) | 1.2 → 2.1 → 2.2 → 2.3 | migrations `20270113010000`–`20270113999999`; pgTAP `276`–`285`; SQL functions `approval_decide`, `cmo_decide_post`, `cmo_post_myself`, `schedule_propose`, `schedule_follow_deliverable`, `correction_from_edits`, `cmo_decide_correction`, the post card's `approval_snapshot` part; `components/cards/**`; `lib/cmo/jobs/classify-edits.ts`, `lib/cmo/jobs/distill-ratings.ts` (new), `lib/cmo/voice.ts` (new); the job's registration in `lib/cmo/jobs/runner.ts` and `packages/contracts/capabilities.json`; `components/screens/library/LibraryScreen.tsx` (Voice tab); `lib/cmo/skills/no-ai-slop.check.ts`; `docs/architecture/approval.md`, `schedule-publish.md` (+ `.html`) |
| **B: Today and the first run** ([`B-today-first-run.md`](2026-11-09-cmo-review-3-sessions/B-today-first-run.md)) | B0 → 1.1 → 1.3 → 3.1 → 3.2 → 3.3 → 3.4 | migrations `20270114010000`–`20270114999999`; pgTAP `286`–`295`; SQL functions `cmo_enqueue`, `start_cmo_run`, `cmo_first_run_free`, `cmo_require_paid`, `cmo_onboarding_answers`, `product_events` and its triggers; `lib/cmo/today.ts` (new), `lib/cmo/digest.ts`, `lib/cmo/onboard.ts`, `lib/cmo/loops.ts`, `lib/cmo/schedule.ts`, `lib/paid-first.ts`, `lib/api/errors.ts`; `lib/screens/dashboard.ts`, `load.ts`, `registry.ts`, `fixtures/dashboard.ts`; `components/dashboard/**`; `components/billing/PlanSheet.tsx` (new); `components/screens/setup/**`; `components/screens/library/BusinessDocs.tsx`; `app/app/page.tsx`, `app/api/v1/cmo/onboarding/route.ts`, the chat and Sales 402 lines; the landing, billing and `llms.txt` copy |

**Built once, first (B0, pushed before anything else):**
- `cmo_require_paid(p_user)` and its error code;
- the 402 `plan_required` mapping in `lib/api/errors.ts`;
- `PlanSheet.tsx`;
- the `today` contract (types in `lib/cmo/today.ts` and the screen schema).

A imports them and never writes its own.

**Hand-offs**, written as requests in the other session's file:
- A gives B `rateDraftsPending(supabase)` in `lib/cmo/voice.ts`, which B's Today calls for the 2.2 row.
- A calls `cmo_require_paid` in its own functions once B0 has landed.
- B's activation triggers read the tables A changes but never A's functions.

**`supabase/schema/current.sql`** is regenerated with `scripts/dump-schema.sh` by each session after it rebases on
the branch head, and never merged by hand.

## 7. Rule: every group ends with a code review

1. When a session finishes a group's items (group 1, then 2 or 3), it runs **`/code-review high`** on that group's
   commits (`<first commit>^..HEAD`).
2. If the diff touches SQL, credits, RLS, a route or the paywall, it also works through the
   `security-review-checklist` skill. Migrations follow the `supabase-migrations` skill.
3. Every CONFIRMED finding is fixed in its own commit. A PLAUSIBLE finding is fixed or answered in one line.
4. The session writes the review in its session file under "Reviews": the date, the commit range, the findings and
   what was done with each.
5. The group is done only after that, with its checks green: pgTAP on a reset database, `npm run typecheck`,
   `npm run build`, `check:contracts`, the new unit and e2e tests, and `cmo:eval -- --provider fake` where a prompt
   changed.
6. At the end of phase 1, the session runs `/code-review high` once more on its whole diff, then hands it to the
   reviewer (this planning session), who reviews the PR before the owner merges.
7. "Verify by looking": screenshots of Today, the post card, the rating sheet and Setup at 1280 px and 390 px, in
   light and dark, attached to the session file and looked at.

## 8. Phase 2, after phase 1: the script where the founder works (group 4)

This is the first draft of this plan, in short. Its full text is in this file's history (`d2f68ad6`), and its session files are in
[`2026-11-09-cmo-review-3-sessions/phase-2/`](2026-11-09-cmo-review-3-sessions/phase-2/). Before phase 2 starts, the
reviewer re-checks it against `main` and splits the work again.

- **I2, the prompter: already on `main`** (`app/app/script/[order]/prompter`, `components/screens/script/Prompter.tsx`,
  "Read on your phone" in Writer and Studio, commits `6e60537` and `1c301fb`). The owner's choice of login and no
  share link is built.
- **I0, the CMO chat orders a script** (`cmo_order_script`, the price card first, 1 credit like a post draft) and the
  CMO eval cases C1 left open.
- **I1, a Script tab in the editor:** the beats, a seek to each marker, an edit to a beat (one Undo step). The script
  has one home: `work_orders.brief.storyboard`.
- **I3, the take against the script:** said, partly said or not said per beat (`findQuote`, no model call). "Keep
  only the script" proposes the cut and waits for the founder.
- **Not in phase 2:** recording in the app, AI images for the storyboard, articles (research first).

## 9. Done when (phase 1)

- A new founder signs up, enters a website and watches the steps. They answer or skip the questions, then read their
  strategy, their week and three X drafts, without paying.
- They rate the drafts, accept the rules, and see them in Library → Voice with their history.
- They press Approve on a post and get the plan sheet. Once they pay, Approve sends out the words and the time in
  one decision, and no schedule card follows.
- Today shows at most 5 rows with "N of M done", brings a silent platform to the top, and the morning email starts
  with the same rows.
- `product_events` records the funnel, and the `activation` view answers "first approve within 24 h".
- Every group's `/code-review` is written up in its session file, and CI is green.

## 10. Not in this plan

- Sales `ruleCheck`, the disclosure line, and blocking founder rules that risk a ban. These wait for real
  ScrapeCreators fixtures (Okara §6.8).
- Pausing a plan instead of cancelling it, and the monthly credit budget page (Okara §6.9, §6.10).
- One card for a video deliverable and its time.
- Turning on publishing through Zernio (`OPENCMO_PUBLISH_LIVE`, the owner's step), and releasing UI v2
  (`NEXT_PUBLIC_OPENCMO_UI`). Phase 1 builds on v2. It is worth something to founders only once v2 is released, and
  that release is the owner's.
- Backlog from the Okara study, each needing its own plan: real competitors through web search, a `/mcp` marketing
  page, read-only Search Console with an `llms.txt` tool, a multi-site discount, "Ask your CMO" on charts and cards,
  and approvals over Telegram or Slack.
- Not learned from Okara: autopilot, auto-publish, false urgency, review gating, Reddit through CORS proxies, a video
  downloader, holding influencer money, several LLM vendors, and state in localStorage.
