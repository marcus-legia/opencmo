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
