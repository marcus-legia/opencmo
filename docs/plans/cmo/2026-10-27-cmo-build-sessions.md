# UI and brain wave 1: work split for three sessions, one PR

Plans: [`2026-10-27-ui-build-plan.md`](2026-10-27-ui-build-plan.md) (UI, tasks U0–U9) and
[`2026-10-27-brain-departments-plan.md`](2026-10-27-brain-departments-plan.md) (brain wave 1, tasks W1-0 to W1-6).
Read both first: their todo lists are the source of truth; this file only says who does what, in which order.
Design frames: [`2026-10-27-app-redesign-frames/`](2026-10-27-app-redesign-frames/).

Branch: **`cmo-build`**, cut from `cmo-plan` (the branch holding these plans, stacked on PR #118's branch
`claude/ai-cmo-feasibility-report-0g6pku`, which holds the architecture pages they link to). Once both are merged,
cut it from `main` instead. Session A opens one draft PR for it; all three sessions share it.

## 0. Scope: how much of the system this plan builds

Read this first. **This is not the whole system.** It builds the whole UI and the first quarter of the brain.

| Part | Covered here | Coverage | Not covered here (needs its own plan) |
|---|---|---|---|
| **UI** | every screen designed on the canvas (13 screens + the approval card kit, desktop and phone), behind the flag `NEXT_PUBLIC_OPENCMO_UI=v2` | **100% of the designed screens** as UI; data is typed sample data until its backend lands | the inside of the editor (it keeps its current look), landing, blog, billing pages |
| **Brain** | wave 1: B0 corrections + budget, B1 work orders + deliverables, B2 progress check + pause + digest | **3 of 5 brain phases** (B3 registry + event rules + Studio adapter, B4 evals are wave 2–3) | B3, B4 |
| **Approval** | A0 one approvals table and decide RPC (post, reply, goal, correction cards) | **1 of 4 phases** | A1 Studio cards, A2 phone + email, A3 schedule cards with expiry |
| **Departments** | none of their own phases; wave 1 only wires the departments that already run (X posts, Reddit scan, competitor research, metrics) to work orders | **0 of 19 department phases** (Studio S0–S4, Schedule P0–P3, Writer W0–W4, Research/Sales R0–R4) | all of them, waves 2–3 |
| **Overall backend** | 4 detailed phases (B0, B1, B2, A0) | **4 of 28 phases ≈ 15%** | 24 phases, outlined in the brain plan §6 |

What works for a real founder when this plan is done: one approval queue on the Dashboard for posts, Reddit replies,
goals and corrections; the week plan as work orders on the Brain page; the team graph and live log moving on real
orders; Pause CMO; the digest in the app; Library (documents, Brand Kit); Settings (budget, time zone, pause); the
pages whose data already exists (Research insights, Writer for X, Sales scan, Studio uploads and edits, Setup).
Everything else on screen is sample data, and those screens stay hidden in production.

Phases and their names come from `docs/architecture/` (`brain.md` §11, `approval.md` §11, `studio.md`,
`schedule-publish.md`, `writer.md`, `research-sales.md`).

| Session | Name | Tasks | Screens it owns |
|---|---|---|---|
| **A** | Brain backend and contracts (lead) | U0, W1-0 to W1-6 | none; owns the data every screen reads |
| **B** | UI foundation, shell, Dashboard, cards | U1, U2, U3, U4, U9 (lead) | S1, S2, S3 |
| **C** | Pages | U5, U6, U7, U7b, U8 | S4 to S13 |
| **Planner** | Review (the session that wrote these plans) | reviews at M1, M2, M3 | — |

## Rules for all sessions

1. **Own your paths** (below). A file under "Shared" may be edited by anyone, only in its named block:
   `git pull --rebase` right before editing it, push right after.
2. **Same branch, no force.** `git pull --rebase origin cmo-build` before every push. Never
   `--force`, never rebase pushed commits, never push to `main`, never merge the PR.
3. **Small commits, prefixed** `[A]`, `[B]` or `[C]`, in English, each green on its own (typecheck plus the tests of
   what it touches).
4. **Tick your boxes** in the plan's todo list and below, in the commit that finishes the item.
5. **Repo rules apply** (`CLAUDE.md`): English everywhere; comments explain why; no model names in copy; every write
   through an RPC; sample data never reaches production users (flag `NEXT_PUBLIC_OPENCMO_UI=v2`, `live` flags).
6. **Migrations belong to Session A only**, in timestamp order after `20261226100000`; A regenerates
   `supabase/schema/current.sql`. B or C need SQL → a "Requests" note below.
7. **Contracts belong to Session A** (`apps/web/lib/screens/`). B and C code against the types and fixtures; a change
   goes through a "Requests" note.
8. **Primitives belong to Session B** (`apps/web/components/ui/`). C needs one that is missing → "Requests"; until it
   lands, C builds it locally in its own folder and swaps it later.
9. **Heavy suites one at a time** on one machine (`npm run build`, `db:reset`/`db:test`, e2e).
10. **Do not deploy, do not turn the flag on in production.** Release is the owner's.

## Milestones and review

| Milestone | Done when | Review |
|---|---|---|
| **M1** foundations | A: U0 contracts + fixtures + screens route, W1-1. B: U1 primitives, U2 shell. C: every route renders its skeleton under the flag. | Planner reviews contracts against the frames and primitives against `Tokens.dc.html` before anyone builds on them |
| **M2** every screen on fixtures | B: U3, U4. C: U5–U8. A: W1-2, W1-3. | Planner reviews each screen side by side with its frame (screenshots from U9) |
| **M3** wave 1 live | A: W1-4, W1-5, W1-6. B: U9 green. | Planner reviews the whole PR (`/code-review`, security checklist for the migrations) |

At each milestone the lead (A) posts one PR comment "M1 ready for review" (M2, M3) listing commits and screenshots;
the owner forwards it to the planner session.

## Session A: brain backend and contracts (lead)

**Owns:**
- `supabase/migrations/*_brain_b0.sql`, `*_approvals.sql`, `*_work_orders.sql`, `*_brain_pause.sql`,
  their tests in `supabase/tests/`, `supabase/schema/current.sql`
- `apps/web/lib/screens/` (schemas, fixtures, loaders, `screens.check.ts`), `apps/web/app/api/v1/screens/`
- `apps/web/lib/cmo/jobs/` (plan_week tree, runner hooks, progress check), `apps/web/lib/cmo/pending.ts`,
  `apps/web/lib/cmo/digest.ts` (new)
- `docs/plans/cmo/2026-10-27-screen-contracts.md`

**Order:** W1-0 → **U0 first, push it as soon as `screens.check` passes** (B and C wait on it) → W1-1 → W1-2 → W1-3
→ W1-4 → W1-5 after each, flipping `live` flags → W1-6.

- [x] W1-0 baseline
- [x] U0 contracts, fixtures, screens route, contract doc
- [x] W1-1 B0 corrections and budget
- [x] W1-2 A0 approvals table
- [x] W1-3 B1 work orders, deliverables, events
- [x] W1-4 B2 progress check, pause, digest
- [x] W1-5 loaders live: Dashboard, Brain, Library, Settings
- [ ] W1-6 acceptance run

## Session B: UI foundation, shell, Dashboard, cards

**Owns:**
- `apps/web/styles/ui-v2.css`, `apps/web/components/ui/`, `apps/web/components/shell-v2/`,
  `apps/web/components/dashboard/`, `apps/web/components/cards/`
- `apps/web/app/app/page.tsx` (v2 branch), `apps/web/app/app/inbox/`, `apps/web/app/app/design/`
- `apps/web/e2e/ui-v2-dashboard.spec.ts`, `apps/web/e2e/ui-v2-look.spec.ts`, `docs/plans/cmo/2026-10-27-ui-build-frames/`

**Order:** U1 (push primitives early: C uses them) → U2 → U3 → U4 → U9 when C is at M2.

- [ ] U1 tokens and primitives, `/app/design`
- [ ] U2 shell, phone tab bar
- [ ] U3 Dashboard, desktop and phone
- [ ] U4 approval cards, `/app/inbox/[id]`
- [ ] U9 look check, axe, full suite

## Session C: pages

**Owns:**
- `apps/web/components/screens/` (one folder per page: `analytics/`, `brain/`, `library/`, `research/`, `writer/`,
  `studio/`, `sales/`, `schedule/`, `settings/`, `setup/`)
- `apps/web/app/app/analytics/`, `brain/`, `library/`, `research/`, `writer/`, `studio/`, `sales/`, `schedule/`,
  `setup/` (new), and the v2 branches of `apps/web/app/app/settings/page.tsx` and `apps/web/app/app/brand/page.tsx`
- `apps/web/e2e/ui-v2-pages.spec.ts`
- U7b (Studio replaces My projects): `apps/web/app/app/projects/` and `apps/web/app/app/jobs/` (redirects),
  `apps/web/components/clipping/web/LibraryView.tsx`, `ProjectView.tsx`, `apps/web/components/clipping/ProjectLibrary.tsx`,
  `apps/web/e2e/projects-delete.spec.ts`; the old-page links in `components/editor/EditorShell.tsx`, `ClipPicker.tsx`,
  `DeviceCheck.tsx` and the `projects` entry of `components/clipping/web/WebShell.tsx` (those lines only)

**Order:** skeleton routes for every page (flag-gated, empty) while U0 and U1 land → U6 Library (its data is live
today) → U5 Analytics, Brain → U7 Research, Writer, Studio, Sales, Schedule → U7b Studio replaces My projects → U8 Settings, Setup.

- [x] Skeleton routes
- [x] U6 Library
- [x] U5 Analytics, Brain
- [x] U7 department pages
- [x] U7b Studio replaces My projects (redirects under the flag; deletion waits for U9)
- [x] U8 Settings, Setup

## Shared (named blocks only)

- `apps/web/app/app/layout.tsx`: B owns the v2 branch; A may add one loader call for the shell in the block marked
  `// screens: shell`.
- `apps/web/package.json`: A adds `screens.check` to `check:contracts`; B and C add their e2e files to the e2e list.
- This file: each session ticks only its own section and appends to "Requests".

## Requests

(Append: `[from → to] what, why`. The owner of the path answers here and links the commit.)

- `[C → A]` Screen contracts: until U0 lands, C types each page's data in `components/screens/<page>/data.ts`
  (types + sample content from the frames). Take them as a starting point for `lib/screens/` or tell C the field
  names that differ; C then swaps the imports and deletes its copies.
  - `[A]` Landed in `531d414`: `apps/web/lib/screens/` (one schema per screen, fixtures in `fixtures/`, registry,
    `GET /api/v1/screens[/name]`), field-by-field sources in
    [`2026-10-27-screen-contracts.md`](2026-10-27-screen-contracts.md). Library differences from C's `data.ts`:
    `voice.wordsCut` (not `cutWords`); skills are `skills.writing` / `skills.video` with `note`, `origin`
    (`built_in | yours`) and `enabled` (not `source`, `on`); a voice note has `replaces` (the older note, quoted)
    instead of folding it into `source`. "Who reads what" stays product copy in the UI, as C did. Reading Business
    and Brand Kit through today's `/api/v1/cmo/documents` and `/api/v1/brand-kits` is fine; Library's `documents` and
    `brandKits` go live in the screens route at W1-5 for the read view, and edits keep using those routes.
  - `[C]` Done: Analytics, Brain and Library's Voice/Skills read `/api/v1/screens/[name]` through
    `components/screens/useScreen.ts` and the `lib/screens` types; C's `data.ts` copies are deleted.
- `[C → B]` Primitives: C builds stand-ins in `components/screens/kit/` with the U1 names (`Button`, `Chip`, `Tabs`,
  `Segmented`, `Panel`, `Kpi`, `MonoLabel`, `Toggle`, `EmptyState`, `SampleTag`) and tokens as `--scr-*` copied
  from `Tokens.dc.html`. Swapped for `components/ui/` when U1 lands.
- `[C → B]` Flag helper: `components/screens/flag.ts` (`UI_V2`, `requireUiV2()`). Move it under `components/ui/` or
  `lib/` if you prefer; C will follow.
- `[C → B]` `/app` with no documents should send the founder to `/app/setup` under the flag (B owns the v2 branch
  of `app/app/page.tsx`; Setup is C's S13).
- `[C → B]` "Ask your CMO" on the Brain page links to `/app?ask=1`; please open the Dashboard's ask box on that
  param (or tell C the link you prefer).
- `[C → A]` Brain's Pause button takes an `onPause` prop (`components/screens/brain/PauseButton.tsx`); it stays
  disabled with a note until W1-4's pause RPC exists. Tell C the RPC name and C wires it on Brain and Settings.
  - `[C]` Wired: `PauseButton` takes `pausedAt`, `live` and `onChange`, posts to `/api/v1/cmo/pause`, and shows
    Resume CMO while paused (Brain header and Settings' off switch). B can use the same component on the Dashboard.
- `[C → A]` Sales' stuck banner has "Add N credits and finish": C needs a route or RPC that raises this week's Sales
  budget by `creditsToFinish` and resumes the scan. Disabled with a reason until then. Live thread actions already
  call `POST /api/v1/cmo/opportunities/[id]` (`replied` / `dismissed` + reason) when `live.threads` is true, so
  the loader's thread ids must be `cmo_opportunities` ids.
- `[C → A]` Studio reads uploads live from today's `/api/v1/projects` (U7b parity) and only generated items from the
  screens route. When the studio loader goes live, give upload items `projectId` = the project id: Studio drops
  screen items whose `projectId` it already has, so nothing shows twice. "Mark finished" needs a route (an edit
  marked finished, so Shorts can be cut from it); disabled with a reason until then.
- `[C → A]` Settings saves with `PUT /api/v1/cmo/settings` and body `{ weeklyCreditBudget, timezone, digestHour }`
  (the `save_cmo_settings` RPC from W1-1, 422 text from the RPC shown as is). C calls it only when the screen's
  `weeklyCreditBudget`, `timezone` and `digestHour` are live, so the route can land with W1-5. "Who does the
  thinking" is drawn read-only from `cmo.mode` (today `brainMode` decides it from credits); say if the founder
  should get a real choice and C wires it.
- `[C → B]` Setup (`/app/setup`) renders inside the shell; the frame draws it without the rail. If the v2 layout
  can hide the rail for `setup`, Setup needs nothing else.

- `[A → B]` A0 landed (W1-2): the Dashboard `queue` is live from `approvals`, and every card has `contentHash`.
  Decide a card with `POST /api/v1/approvals/[id]` `{ action, contentHash, text?, reason?, goal?, target? }`
  (actions per kind in [`2026-10-27-screen-contracts.md`](2026-10-27-screen-contracts.md) S3); it answers the
  card as it is now. `GET /api/v1/approvals/[id]` serves `/app/inbox/[id]`. The rail badge (`pending`) counts
  the same rows. Today's `components/cmo/workspace/actions.ts` RPCs still work and close the card too, but only
  the new route checks the hash, so U4 should use it. Realtime: subscribe to `approvals` (RLS filters to the
  founder) to refresh counts.

- `[A → B, C]` B2 landed (W1-4). Pause CMO: `POST /api/v1/cmo/pause` `{ paused: true | false }` → `{ pausedAt }`;
  pass it to `PauseButton`'s `onPause` (Dashboard header, Brain, Settings). Settings save:
  `PUT /api/v1/cmo/settings` `{ weeklyCreditBudget, timezone, digestHour }` (C's call already matches; it refuses an
  unknown time zone with "Choose a time zone from the list."). The Dashboard contract gained `digest`
  (`DigestSchema`: `dateLabel`, `waiting[]` with card ids for `/app/inbox/[id]`, `wentOut[]`, `stuck[]`; null = none);
  B shows it at the top of the queue. `cmo.pausedAt`, Settings and the digest turn live in W1-5.

## Prompts to start each session

Paste one into a new Claude Code session on this repository.

**Session A**
> You are Session A (brain backend and contracts, lead) of `docs/plans/cmo/2026-10-27-cmo-build-sessions.md`. Read
> that file, `2026-10-27-ui-build-plan.md`, `2026-10-27-brain-departments-plan.md`, `docs/architecture/brain.md`
> and `approval.md`. Create branch `cmo-build` from `cmo-plan` if it does not exist and open a draft PR into `cmo-plan`.
> Do W1-0, then U0 and push it first, then W1-1 to W1-6 in order, following the rules in the sessions file.

**Session B**
> You are Session B (UI foundation, shell, Dashboard, cards) of `docs/plans/cmo/2026-10-27-cmo-build-sessions.md`.
> Read that file, `2026-10-27-ui-build-plan.md` and the frames in `2026-10-27-app-redesign-frames/` (start with
> `Tokens.dc.html`, `Main.dc.html`, `DashboardPhone.dc.html`, `Cards.dc.html`). Work on branch
> `cmo-build`. Do U1 and push the primitives early, then U2, U3, U4, then U9.

**Session C**
> You are Session C (pages) of `docs/plans/cmo/2026-10-27-cmo-build-sessions.md`. Read that file,
> `2026-10-27-ui-build-plan.md` and the frames in `2026-10-27-app-redesign-frames/`. Work on branch
> `cmo-build`. Build the skeleton routes first, then U6, U5, U7, U7b, U8, using Session B's
> primitives and Session A's screen contracts as they land.
