# Session B — app screens (v2)

Plan: [`../2026-11-18-free-scan-plan.md`](../2026-11-18-free-scan-plan.md). Branch `claude/free-scan`.
Read the plan's Global constraints and shared contract first. Production runs UI v2: work and verify there.

**Owns:** `apps/web/lib/screens/load.ts` (the sales block, about lines 1355–1410), `apps/web/components/today/AgentSales.tsx`,
`apps/web/components/screens/setup/*`, `apps/web/lib/cmo/onboard-status.ts` (+ `.check.ts`), the `PlanSheet` call sites in
`AgentSales.tsx` and `components/cmo/workspace/CmoWorkspace.tsx` (the `action` prop only).

## Tasks

### - [ ] B1. Loader (after A1)

- `sales.free`: the account is unpaid (`cmo_paid` through the RLS client, or the profile/credits the shell already
  loads: reuse, do not add a second query if one exists).
- `sales.lastScan`: the newest `sales_scan` run's `output` parsed as `SalesScanOutput`, or null.
- Each card: `drafted = reply !== "" || rule === "skip"`. **When `sales.free`, select the card without `reply`** and
  send `reply: null`: the screen never holds text the founder has not paid for.
- Typecheck. Commit `Free scan B1: the Sales loader knows free accounts and the last scan` and push.

### - [ ] B2. Cards without drafts

- A card always shows: source and community, title, age, score, and the pain and evidence quotes from `score_parts`
  (they are the proof; today they may sit behind a detail toggle: lead with them).
- Not drafted and free: in place of the draft, one line and one button: "Your reply is written once you pick a plan."
  / "Pick a plan" opening `PlanSheet` with `action="reply to these people"`. "Copy and open thread" and "Mark replied"
  are hidden; "Open thread" (plain link) stays.
- Not drafted and paid: "Write the replies · 1 credit" at the top of the list starts `sales_reply_drafts` via
  `/cmo/runs` and shows its steps like the scan does.
- "Scan now" for a free account whose free scan is used: opens `PlanSheet` with `action="scan again"` instead of the
  402 error text.
- `CmoWorkspace.tsx` (v1): pass `action="scan for customers"` when the 402 came from `sales_scan`.
- Look at it in a browser at 1440px and 390px. Commit `Free scan B2: cards lead with the evidence; replies after a plan` and push.

### - [ ] B3. The fit verdict

- `lastScan.verdict === "none"` and no cards: a calm empty state, not an error: "No one asked about this in the last
  30 days." then "We searched for:" with `lastScan.queries` as a short list, and the places it looked
  (`lastScan.platforms`, with any `failed` named as "did not answer"). For a free account: no PlanSheet here; offer
  "Edit what Sales looks for" (the existing Settings tab) instead.
- Copy goes through no-ai-slop: no em dashes, no hype.
- Commit `Free scan B3: say plainly when no one is asking` and push.

### - [ ] B4. Setup leads to Sales (after A4)

- Setup's steps: "Website / What it learned / First people" (`SetupScreen.tsx:113-115`); "What happens next" names the
  scan first (finding people who describe the problem, with their words), then the week's posts.
- `?site=` present and no documents yet: start reading at once (one effect, guarded so a reload does not start twice;
  `start_cmo_run` already refuses a second running onboarding).
- When Setup is finished, go to `/app/sales` instead of `/app` (`SetupScreen.tsx:56,79`) while the free scan runs or
  has cards; otherwise `/app` as today.
- `onboard-status.ts`: a step for the scan if A4 returns `firstScan`, with its `.check.ts` updated.
- Browser check of the whole path with the local stack. Commit `Free scan B4: Setup ends on the people asking` and push.

## Requests

(none yet)
