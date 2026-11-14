# Session C — chat, Sales screen and docs

Plan: [`../2026-11-14-sales-finder-plan.md`](../2026-11-14-sales-finder-plan.md). Branch `claude/sales-finder`.
Commit and push after every task. Read the plan's Global constraints first.

**Owns:** `apps/web/lib/agent/cmo-tools.ts`, `apps/web/lib/agent/prompt.ts`, `apps/web/lib/agent/cmo-decisions.ts`
(+ `cmo-decisions.check.ts`),
`apps/web/app/api/v1/sales/settings/route.ts`, `apps/web/lib/screens/sales.ts`, the `sales` loader in
`apps/web/lib/screens/load.ts`, the Sales fixture in `apps/web/lib/screens/fixtures/`, `apps/web/components/today/AgentSales.tsx`,
`apps/web/components/screens/sales/SalesSettings.tsx`, `docs/architecture/research-sales.{md,html}`,
`docs/plans/cmo/README.md` (this plan's row), the status line of `2026-10-31-sales-finder-spec.md`.

**Waits on:** A1 for C1; A2 (the `p_platforms` argument and the column) and B2 (`salesScanCard(brief, platforms)`) for C2.

## Tasks

### - [x] C1. The chat asks for places, and refuses a scan with nowhere to look

**Consumes:** `SALES_PLATFORMS`, `SalesPlatform`, `PLATFORM_LABEL` (A1); `salesScanCard(brief, platforms)` (B2 — until
B2 is pushed, pass only `brief`).

Decisions:
- `create_task` schema gains `platforms: { type: "array", items: { enum: SALES_PLATFORMS }, description: "sales only: where to look. Leave it out to use the founder's Sales settings." }`;
  `taskInput` gains `platforms: z.array(z.enum(SALES_PLATFORMS)).min(1).max(4).optional()`. `pricedTaskCard` refuses
  (`null`) `platforms` on any agent but `sales`, the way it refuses `thread`.
- The `sales` agent's description line in `create_task`: "sales: find people describing the problem in conversations on
  Reddit, Hacker News, public Facebook groups and Threads (not X), score them with quotes, draft replies the founder
  posts themselves (5 credits; only when the founder asks)."
- Before `startCmoRun` for `sales_scan`, read `sales_settings.platforms` under RLS (default all when no row). If the
  task's `platforms` and the settings share nothing, return `invalid("Sales is turned off for <labels>. Turn it on in
  Sales settings, or ask for another place.")` — nothing is held (Review focus 4). Pass `platforms` into the run input
  when given.
- The run label `sales_scan: "Scanning Reddit"` becomes `"Scanning conversations"`.
- `prompt.ts`, research line: Sales covers Reddit, Hacker News, Facebook groups and Threads; X conversations are not
  searchable yet, say so when the founder asks for X instead of promising it.
- `set_sales_settings` in `cmo-decisions.ts` gains optional `platforms` (same zod), a card line
  `Look on: <labels>`, and passes `p_platforms`; the route `app/api/v1/sales/settings/route.ts` gains optional
  `platforms` and returns `platforms`.

- [x] Failing checks (extend `lib/agent/cmo-decisions.check.ts` and the `create_task` checks next to `pricedTaskCard`):
  - `pricedTaskCard({ agent: "sales", brief: "find x", platforms: ["threads"] })?.card.changes[0]` starts `Scan Threads`
    (needs B2; if B2 is not pushed yet, add this one assertion in C2 instead);
  - `pricedTaskCard({ agent: "x_writer", brief: "x", platforms: ["reddit"] })` is `null`;
  - `platforms: ["x"]` is refused by the zod;
  - `set_sales_settings` with `platforms: []` is invalid; with `["reddit"]` its card says `Look on: Reddit`.
- [x] Implement; run the checks and `npm run typecheck`. Also in `lib/agent/scope.ts` (`plan`): the price card names only
  the places the founder's switches allow, and a scan with nowhere to look is refused before the card is shown.
- [x] Commit `Sales finder C1: the CMO chat asks Sales to look on Facebook groups and Threads`, push.

### - [x] C2. The Sales screen shows where each thread is, and the switches

Decisions:
- `ThreadSchema` gains `platform: z.enum(SALES_PLATFORMS)`; `settings` gains `platforms: z.array(z.enum(SALES_PLATFORMS)).min(1).max(4)`.
  The loader selects `platform` and `sales_settings.platforms`; the sample fixture gets one Facebook and one Threads thread.
- Thread row meta starts with `PLATFORM_LABEL[t.platform]`; `community` follows unless it equals the label.
- "Where it looks" lists the four platforms from `SALES_PLATFORMS` with "on" / "off" from `settings.platforms`
  (replacing the fixed Reddit and Hacker News rows); Reddit keeps "all but N excluded".
- `SalesSettings.tsx`: one checkbox per platform above the excluded subreddits, saved with the rest through the
  route; the last checked box cannot be unchecked (disabled, with the title "Keep at least one place").
- `ScanNow` builds its card with `salesScanCard(undefined, data.settings.platforms)`.

- [x] Run `npm run typecheck`, `cd apps/web && npm run check:contracts`.
- [x] Look at it: `npm run dev`, open `/app/sales?sample=1` at 1440 and 390 wide, light and dark; the four platforms,
  a Facebook and a Threads row, the settings checkboxes. Put the screenshots in the PR description (not the repo).
  Looked at 2026-11-14 on a local dev server (sample data): 1440 and 390, light and dark, no horizontal scroll; the
  last checked box is disabled with its title; Scan now names the four places. The Sales settings panel had no styles
  on `/app/sales` (`screens.css` is loaded by `parts.tsx`, which this page does not use; the excluded chips showed as
  bullets before this change): `SalesSettings.tsx` now imports it. Screenshots were not attached to the PR (no upload
  from this session).
- [x] Commit `Sales finder C2: platforms on the Sales screen and in its settings`, push.

### - [ ] C3. End to end on the owner's account (needs the owner, spends about 5 OpenCMO credits)

- [ ] Ask the owner to run, on the Vercel preview of the PR with the migration applied to a branch database or local
  stack: "find people asking how to get their first customers for a SaaS" in the CMO chat. Expect: a price card naming
  four places; after Approve, the chat's run line, Sales' progress card with a Facebook and a Threads step, threads
  labelled by platform, replies with no link.
- [ ] Write what happened (and the run id) in this file. A failure is a Request to the session that owns the code.

### - [x] C4. Whole-PR review, then the docs

- [x] `/code-review high` on `origin/main...claude/sales-finder` and `security-review-checklist`; fix CONFIRMED findings
  in C's files, route the rest as Requests; write them under Review.
- [x] `docs/architecture/research-sales.md` and `.html` (same change in both): Sales reads four platforms; the table row
  "Sales scan"; "Left": X (official API, paid), creators, R0.
- [x] Spec status line: "v1 built (conversations; Reddit, HN, Facebook groups, Threads): `2026-11-14-sales-finder-plan.md`".
- [x] `docs/plans/cmo/README.md`: this plan's row says `claude/sales-finder` → `main` and the PR number.
- [x] Commit `Sales finder C4: docs`, push.

### - [ ] C5. Review of C's own commits (plan §Code review after each session)

## Review

**C3 is not done:** it needs the owner on a preview with the migration applied, and spends real credits.

**C4, `/code-review high` on `origin/main...claude/sales-finder`** (after A, B and C pushed), then `security-review-checklist`.
Fixed in `C: review fixes`:

1. **Fixed (A's request to C).** Reply cards called every conversation Reddit: `approval-card.ts` took only `hn`,
   `cards.ts` fell back to "Reddit", the kind line was `Reddit · <community>` and the kind label "Reddit reply". The card
   now carries any `SalesPlatform`, the line is `<platform> · <community>` (the community only when it differs), the
   label is "Reply". Check in `screens.check.ts`.
2. **Fixed (A's request to B, in `sales-scan.ts`).** The finders paid to read posts the founder had already seen; the
   scan now passes `skip` (raw and normalised seen URLs).
3. **Fixed.** Facebook could spend 15 of the 16 shared lookups before Threads ran; each now has 8.
4. **Fixed.** A lookup-budget error text ("… Summarize what you found.") could become the run's error; a social
   platform that fails now says "<platform> did not answer. Try again in a minute." (a missing key keeps its own text).
5. **Fixed.** After saving Sales settings, Scan now's card and "Where it looks" kept the old platforms until a reload;
   the settings panel now reloads the screen after a live save.
6. **Fixed.** A dated scan from the chat dropped the places asked for without a word; it is now refused with the reason.
7. **Fixed.** Copy still said Reddit only: W4 is "Scan conversations", `list_approvals` names the four places.
8. **Fixed** with 1 (the check).

Security checklist: the migration is new in this PR (not applied anywhere yet); no new table; `sales_settings_save`
keeps `authenticated` only; no credit moves; a scan with nowhere to look is refused before `enqueue_cmo_run` holds a
credit; outside text from Facebook and Threads goes through `cleanUntrusted` and `threadBlock`.

Not run here: `pnpm lint`/`eslint` (fails to resolve modules through this worktree's symlinked `node_modules`), e2e,
`db:test`.

## Requests

- **Done (C4 review fixes).** **From A (A4 review): the reply card treats every non-HN platform as Reddit.** `lib/screens/cards.ts:141` falls back
  to "Reddit" for the community and `lib/screens/approval-card.ts:118` allows only `z.literal("hn")`, so a Facebook or
  Threads conversation becomes a "Reddit · …" card with Reddit's rule text. Widen both to `SalesPlatform` and use
  `PLATFORM_LABEL` for the fallback.
