# Autopilot for posts, and one working screen

## Context

The owner asked three things: check how effective the CMO automation is, add an option that runs without approval, and
fold the many pages into one working screen.

**What the automation does today (read from the owner's own account over MCP, 2026-11-12):**

- The calendar for the next two weeks is **empty** on a Thursday. No planned items means the daily draft loop has
  nothing to do.
- Drafts dated 11, 16 and 19 October were approved on **11 November**. One from 24 October is still in review.
- X posts carry `proposed.mode = "intent"` and no account: no X account is connected, so an approved post is still
  posted by hand. In 14 days the system published **no** post on its own.
- Eight Reddit threads have waited since 2 November. A reply ten days late is worth nothing.
- 4 of the last 7 decisions were skips (drafts drifting to the product pitch; #200 already tightened that).

The machine produces drafts; the loop stalls at every human step. So an autopilot is the right lever, but it only works
with a connected account, and it must not hide the empty-calendar fault.

**Decisions (owner, 2026-11-12):**

1. Autopilot covers **posts only** (X, Threads, LinkedIn) on the founder's connected account. Reddit replies stay
   hand-posted; Sales still has no post button.
2. **A review window**: a post that passes the checks is scheduled at once with a countdown. The founder can edit or
   skip; untouched, it goes out at its time.
3. **One screen**: only `/app`. Context (left) and the CMO chat (right) stay put; the centre switches between Feed,
   Calendar, Sales and Analytics by tab. Writer, Research, Settings and Billing open as drawers. The editor keeps its
   full-screen page.

This changes the product rule "Assist, never act". `CLAUDE.md` is updated in the same PR, dated, with the limits below.

## As built (2026-11-12)

The sections below are the plan as approved. What was built differs in four places, each smaller than planned:

1. **No rewrite of `approval_decide`.** It is 320 lines and calls `require_user()` all the way down.
   `approval_auto_decide` sets the transaction's JWT claim to the card's owner and calls the unchanged
   `approval_decide`, each card in its own sub-transaction. One approval path, nothing redeclared.
2. **`auto_at` is set by a `before insert` trigger on `approvals`** (`approvals_autopilot`), not by redeclaring
   `approval_raise`. The setting is two columns (`profiles.autopilot_platforms`, `autopilot_hours`) plus
   `autopilot_note`, which says why it turned itself off after three skips.
3. **One screen without moving the routes.** `/app/schedule`, `/app/sales`, `/app/analytics`, `/app/writer`,
   `/app/research`, `/app/settings` and `/app/billing` keep their URLs (no redirects, no link changes, old bookmarks
   work). What changed is the frame: `ShellV2` draws all of them in the feed's frame, with the Context column on the
   left (`components/today/WorkspaceSide.tsx`, lifted out of `Feed.tsx`) and the CMO chat as a column on the right.
   The App Router keeps that layout mounted between sibling routes, so only the centre changes. Each view keeps its
   artboard styles inside its own `pg-<view>` wrapper.
4. **Writer, Research, Settings and Billing open in the centre**, not as overlay drawers: same bar, same columns.
   The bar has four tabs (Feed, Calendar, Sales, Analytics); the "Agents › Sales" crumbs and the Chat button are gone.
   A calendar item's detail opens over the chat column, and only when the founder picks an item.

Not done: Part 1. The owner's `cmo_runs` cannot be read from a development session; the query is in the PR.

Screenshots (sample data, a stand-in for Supabase): [`2026-11-12-autopilot-one-screen-shots/`](2026-11-12-autopilot-one-screen-shots/).

## Branch and order

New branch `claude/autopilot-one-screen` from `main`, one PR, three commits in this order. #201 (schedule) and #202
(auth) are still open; this work does not need them, but #201 should merge first (it fixes the empty/late calendar
this plan depends on). Migration numbers continue after both: `20270119…`, tests `298…`.

## Part 1: find why the calendar is empty (before building on it)

- Read the owner's last `plan_week` runs (`cmo_runs`, the Brain's "Plan and orders" pane, Modal's `cmo_schedule` log).
  Likely causes, in order: the Monday cron did not run or timed out; the plan run failed; the plan's items were all
  more than a day late and never drafted (fixed by #201).
- Fix what is found in its own commit, with a check. If it is #201's fault already fixed, say so and move on.

## Part 2: Autopilot for posts

**Rule, as the founder reads it (Settings → Your CMO → "Post without asking me"):** off by default, one switch per
connected platform, and the hours of the review window (6, 12 or 24; default 12). Only offered on a paid plan with that
platform connected.

**What may go out on its own, all of these true:**

- kind `post`, single post (not a thread, no image waiting), platform connected, proposal `mode = 'publish'`;
- the draft passed the code checks and the checker (`lib/cmo/jobs/check-post.ts`, `writer/checks.ts`) with no fix left
  open, and Creem moderation where an image is attached;
- the founder's brief did not come from the CMO chat with "show me first" (a brief the founder wrote keeps its card);
- under the existing caps: 5 approvals a platform a day (`cmo_decide_post`), `schedule_day_count`, and the card budget.

Anything else raises the normal card. Three skips in a row on a platform turn its autopilot off and say so on the feed.

**SQL (one migration, `supabase/migrations/20270119010000_post_autopilot.sql`, pgTAP `298_post_autopilot.test.sql`):**

- `profiles.autopilot jsonb` (`{"x": true, …}`), `profiles.autopilot_hours smallint`; set only through a new RPC
  `save_autopilot(p_platforms text[], p_hours smallint)` (ownership, paid plan, platform connected). Follows
  `save_cmo_settings`.
- `approvals.auto_at timestamptz`: set in `approval_raise` for a `post` card when the rule above holds
  (`auto_at = least(now() + hours, publish time − 15 min)`, never in the past). The snapshot carries it so the card can
  count down. `decided_via` gains `'auto'`.
- `approval_auto_decide(p_limit int)`: service role only. For each waiting card with `auto_at <= now()`, re-check the
  rule and the content hash, then approve through the **same** path a founder's approval takes: factor the body of
  `approval_decide` into `approval_decide_for(p_user, …)`; the public function keeps `require_user()` and calls it.
  `cmo_decide_post` gets the same split. No second approval logic. The outcome row records `action = 'auto'` so voice
  learning (`cmo_draft_outcomes`, voice notes) never reads an untouched post as the founder's taste.
- A post a founder edits or skips inside the window is an ordinary decision; an edit re-raises the card with a new
  window.

**Runtime:**

- `apps/web/app/api/cron/cmo-digest/route.ts` (hourly, already calls `approval_release_held`) also calls
  `approval_auto_decide`. Publishing itself is unchanged: `schedule_claim_due` → `publish_post` → Zernio.
- Kill switches: `cmoPausedEverywhere()` and the founder's pause (`cmo_paused`) stop auto-decides too.

**UI:**

- `components/cards/ApprovalCard.tsx` / `bodies.tsx`: a card with `auto_at` shows "Goes out Thu 09:00 unless you
  change it" with Edit and Skip leading, and Approve now as the quiet action.
- Feed row meta: "Auto · in 5 h". Activity line when one goes out: "Posted on X without asking (autopilot)".
- Settings panel "Your CMO" (`components/screens/settings/SettingsScreen.tsx`, panel `settings-your-cmo`): the
  switches, the hours, and a plain sentence of what never goes out on its own (Reddit replies, videos, anything that
  costs credits beyond the draft).
- Morning digest (`lib/cmo/digest.ts`): one line "3 posts go out today without asking", linking to the feed.

**Docs:** `CLAUDE.md` product rule 1 rewritten: approval stays the default; autopilot is opt-in, posts only, own
connected account, with a review window; no auto likes, follows, comments, DMs or Reddit replies, ever.
`docs/architecture/approval.md` + `.html` get the auto path.

## Part 3: one working screen

**Shape:** `/app` only. The frame is `ShellV2` → `TodayFrame`, which already holds the top bar, the chat column and
the Context drawer.

- **Centre tabs** `?view=feed|calendar|sales|analytics` (default feed). `Feed`, `CalendarView`, `AgentSales` and
  `AnalyticsView` take no props today, so a new `components/today/Workspace.tsx` renders
  `ContextColumn | <view> | chat` and picks the view from the URL. `ContextColumn` and its sashes move out of
  `Feed.tsx` into it, so they stay mounted when the tab changes. The top bar's `views` variant
  (`components/today/TopBar.tsx`) gains Sales and becomes the only bar; its links become `?view=`.
- **Drawers** over the workspace, reusing the Context drawer's pattern (`?doc=` → `ContextDrawer`, `panes.tsx`, loaded
  on open): `?panel=writer|research|settings|billing`. `AgentWriter`, `ResearchScreen`, `SettingsScreen` and the
  billing page's body become panes. Closing returns to the same tab and scroll position.
- **Redirects**, as `/app/brain` and `/app/library` already do: `/app/schedule`, `/app/sales`, `/app/analytics`,
  `/app/writer`, `/app/research`, `/app/settings`, `/app/billing`, `/app/inbox` → the matching `?view=` or `?panel=`,
  keeping query strings (`?from=`, `#settings-connected-accounts`, Creem's `?paid=1`).
- **Stay as pages:** `/app/editor/*` and `/app/studio` (the editor and its project list, full screen), `/app/setup`
  (onboarding), the phone prompter, `/app/settings/costs` (owner only), `/app/design`.
- **Links:** the ~35 `href="/app/<page>"` in `components/today`, `components/cards`, `components/screens` and the CMO
  chat's link builder (`lib/agent/panel.ts`, which reads `components/shell-v2/nav.ts`) point at the new URLs. The
  email and push links (`lib/notify`) too.
- **Removed once nothing renders them:** the per-route cases of `screenFor` in `ShellV2.tsx`, the `crumbs` top-bar
  variant where unused, `SettingsFrame.tsx`, and the legacy `default` frame.

Phone: the tabs become the bottom bar; Context and chat stay behind their buttons, as on the feed today.

## Files that carry the change

- SQL: `supabase/migrations/20270119010000_post_autopilot.sql`, `supabase/tests/298_post_autopilot.test.sql`,
  `supabase/schema/current.sql`.
- Web, autopilot: `app/api/cron/cmo-digest/route.ts`, `app/api/v1/cmo/settings` (or a sibling route for
  `save_autopilot`), `lib/screens/approval-card.ts` (snapshot field), `components/cards/ApprovalCard.tsx`,
  `components/cards/bodies.tsx`, `components/screens/settings/SettingsScreen.tsx`, `lib/cmo/digest.ts`,
  `components/today/Feed.tsx`.
- Web, one screen: new `components/today/Workspace.tsx`; `components/today/{Feed,TopBar,ContextColumn,panes}.tsx`,
  `components/shell-v2/{ShellV2,nav}.tsx`, `app/app/page.tsx`, the eight redirecting `app/app/*/page.tsx`,
  `lib/agent/panel.ts`.
- Docs: `CLAUDE.md`, `docs/architecture/approval.{md,html}`, `docs/plans/cmo/2026-11-12-autopilot-one-screen-plan.md`
  (this plan, in the repo's format).

## Verification

- pgTAP 298: autopilot off → a normal card; on → `auto_at` set; edit or skip in the window wins; after the window the
  post is approved with `decided_via = 'auto'` and a slot exists; Reddit, threads, unconnected platforms, a paused CMO
  and a changed content hash never auto-approve; the daily cap holds; three skips turn it off. Run on the local
  Postgres as in #201/#202; CI is the authoritative run.
- `npm run typecheck`, `npm run build`, `npm run check:contracts` (the approval-card and screens contracts cover the
  new snapshot field).
- A check for the redirect table: every old path maps to a `?view=` or `?panel=` that exists.
- e2e (`ui-v2-shell`, `ui-v2-writer`, `ui-v2-schedule`, `login`): updated for the new URLs; run where a Supabase
  stack is available. In this session the app cannot be signed into, so screenshots of the workspace at 1440 and 390,
  light and dark, are taken from the screens' fixtures (`lib/screens/fixtures`) through `/app/design` if it renders
  them, and the PR says plainly what was not looked at.
- On the owner's account after deploy: connect X, turn autopilot on for X, and confirm the next draft shows the
  countdown and goes out at its time.

## Not in this plan

- Auto-replies on Reddit or any other community; auto-approving video scripts, slideshows or anything that spends
  credits beyond the draft.
- Folding the editor into the workspace.
- Auto-accepting the weekly plan (the plan's items are drafted without waiting for the plan card already).
