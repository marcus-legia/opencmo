# Session C — UI and e2e

Plan: [`../2026-11-20-wave3-plan.md`](../2026-11-20-wave3-plan.md). Branch `claude/launch`. Match the canvas boards
(https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ). Production runs UI v2.

**Owns:** `components/today/*` (AgentSales, AgentWriter, Feed, ContextColumn, AnalyticsView), the Library page
(`app/app/library`, its component), the documents drawer and page (`components/today/ContextDrawer.tsx` and a new
Your business page), `app/app/research` and its component, `components/screens/settings/*` (Sales scans section),
routes needed by these screens under `app/api/v1/`, e2e specs.

## Tasks

### - [x] C0. Wave 2's red e2e (now, lands in #238)
CI on #238: `ui-v2-activation.spec.ts` (two tests) and `ui-v2-setup.spec.ts` (three) wait for "Start with your
website." and time out: Setup now starts reading on its own when `?site=` is set (free-scan B4). Update the specs to
the current flow (assert the reading progress, then the end on Sales or the Dashboard), keep what they guard (the
answers saved, Skip saves nothing, Approve asks for a plan). Run them, push, and check CI turns green.

### - [ ] C1. Library page (after A2)
"What people said": themes with count, this week's trend, posts that used it, 2–3 quotes each, "Write a post from
this"; filter by source. Left panel link with the quote count.

### - [ ] C2. Post sources (after B3)
Each draft in the Post list shows "Based on N conversations · sources"; the draft view lists each source's summary
and platform. Date and time editable next to Approve (already there or add). "Make an image" stays a small link.

### - [ ] C3. Your business page (after A4)
Five documents in the drawer's list: Product, Strategy (with Where they ask, This week), Competitors, Post plan,
Brand (Voice: paste samples, intro line, words to avoid; Look: colours, font, logo, screenshots, preview). "Read my
website again" asks before overwriting edits.

### - [ ] C4. Sales: reach out, Following up, I replied (after A3, B1, B2)
Per person: "Ready to reach out" with the five checks and their reasons; tabs Public reply · DM · Email (DM: "Copy and
open" the platform's chat; Email: Copy only; locked tabs say why: "Reply in public first"); "I sent it" moves the
person to Following up. "I replied" asks for the link (skippable). Following up tab with
statuses, the nudge, and the status select. Copy through `no-ai-slop`.

### - [ ] C5. Research (after A6)
Competitors display page: logo, site, price, offer, a recent quote, mentions this week; Add by URL (a route that reads
the site with the existing site reader and calls `competitor_add`). Left panel logos (8 + "N more").

### - [ ] C6. Funnel (after A5)
Left panel "This week" (found, replied, answered back, signed up) and Analytics "From a thread to a customer" with the
per-source table. Settings › Sales scans: cadence select.

### - [ ] C8. Research chat, states, tracking (after B7, A5)
Research page: its own chat panel (canvas board Research) using B7's tool, with Add buttons. Sales: the first-scan
progress for a paid account with "while you wait", the banners for a source that did not answer, a failed scan and
Sales not set up (canvas "Scan problems"). Settings › Tracking: the founder's `?ref=ferreto&src=…` links with Copy,
and how "Signed up" is counted. Onboarding: the "who do you sell to?" chips while the site is read.

### - [ ] C7. e2e, look, review
Specs for Library, post sources, reach out and I replied, Following up, Research add, funnel. Screenshots at 1440 and
390. Review the whole wave against the plan. Open the wave 3 PR from `claude/launch`. Do not merge.

## Requests

- **From A (A1, ready):** types for the screens are in `lib/cmo/library.ts` (`LibraryEntry`, `LibraryTheme`) and
  `lib/cmo/reach.ts` (`ReachLevel`, `ReachCheck` with `reasons` for the one-line lock reason, `PersonStatus`,
  `PERSON_STATUSES`); `PostSource` in `lib/cmo/jobs/types.ts`. `ReachCheck` also has `asksForTools`. Loaders and RPCs
  come with A2/A3.
- **From A (A2, ready):** the Library screen (`screen("library")`) has two new live fields: `themes:
  LibraryThemeView[]` (`id, name, count, thisWeek` (last 7 days), `usedInPosts`, `entries` (≤ 3 `LibraryEntry`,
  newest post first)), most quoted first, and `source` (the `?source=reddit|hn|facebook|threads` filter, null for all).
  Not in `release` yet: add them when C1 shows them. Fixtures carry one sample theme. Direct reads: `library_themes`,
  `library_entries` (select, own rows). RPC for founders: `my_library(p_source text default null)`.
- **From A (A3, ready):** founder RPCs: `opportunity_mark_replied(p_id, p_url)` ("I replied" with the reply's
  link; the link must be on the thread's site — Reddit under the same thread, HN item, Facebook same group, a Threads
  post; it also marks a card still in review replied; errors "Paste the link to your reply in this thread.",
  "You dismissed this conversation.") and `opportunity_set_status(p_id, p_status)` (`PERSON_STATUSES`; anything but
  found / not_interested needs the reply first: "Mark that you replied first."). Both return the opportunity row.
  Columns to read (select own rows): `person_status, status_at, reply_url, replied_at, reach_level` (`ReachLevel`),
  `reach` (`ReachCheck` JSON, `reasons` for the lock line), `dm_draft, nudge_draft`. The old `opportunity_reply_url`
  still works. The Sales loader block is yours (A only owns the Library and Research blocks).
- **From A (A5, ready):** `sales_settings_save` now takes `p_cadence text default null` (`mwf | weekdays |
  monday`; null keeps it; error "Scan on Monday, Wednesday and Friday, on weekdays, or on Mondays."): the settings route
  and form (Settings › Sales scans) can pass it; `sales_settings.cadence` to read. `my_funnel(p_days int default 7)`
  returns rows `source` ('all' first, then reddit, hn, facebook, threads), `found, replied, answered_back, signed_up`
  for C6 (1–90 days).
- **From A (A6, ready):** the Research screen has a live `competitors: CompetitorView[]` (`id, name, site, logoUrl,
  price, offer, addedVia, mentions: { week, count }[]` last 8 weeks); not in `release` yet. C5's route reads the site
  with the existing site reader, then calls `competitor_add(p_url, p_name, p_logo_url, p_price, p_offer, p_via)`
  (founder; errors "Paste the competitor's website, like example.com.", "Keep at most 20 competitors.");
  `competitor_remove(p_id)`.
- **From A (A4 heads-up, owner's call 2026-11-19):** A4 lands as one commit that renames the document kind
  `content_strategy` → `post_plan` and moves `voice` / `avoid` out of Strategy into a new `brand` kind, **in every
  file that reads them, yours included** (mechanical edits only). Commit what you have and pull right after A4's
  "Wave 3 A4" commit appears; avoid editing `content_strategy` / `strategy.voice` / `strategy.avoid` code until then.
