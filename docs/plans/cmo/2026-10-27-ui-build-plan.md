# App UI, top-down: build every screen of the redesign

> **For agentic workers:** the screen list (§2) says *what* ships; the todo list (§5) says *how*, task by task, with
> checkbox (`- [ ]`) steps. Three sessions build this plan and the brain plan in parallel: see
> [`2026-10-27-cmo-build-sessions.md`](2026-10-27-cmo-build-sessions.md). Build nothing before Task U0 is done.
>
> **Scope:** read §0 of the sessions file first. This plan set builds 100% of the designed UI (sample data until live)
> and about 15% of the backend (brain B0–B2 and approval A0); it is not the whole system.

## 1. Goal and decisions

**Goal:** every screen of the canvas exists in the real app, at the real routes, with the real components, behind a
flag. A screen whose backend is not ready renders typed sample data marked "Sample data"; the backend plan
([`2026-10-27-brain-departments-plan.md`](2026-10-27-brain-departments-plan.md)) swaps sample data for live data one
screen at a time without changing the UI.

**Owner decisions (2026-10-27):**
- Build the UI first, top-down, even where it does not work yet.
- Brain first for the backend; UI is the goal every backend phase builds toward.
- Dashboard (live team graph of pixel robots, results, the only approval queue), Analytics, Brain, Library, five
  department pages, Settings, Setup. Approval cards live only on the Dashboard; `Cards.dc.html` is a component sheet.
- Tokens: the landing page's (`styles/landing.css`, Landing v4). The editor's media panel is called "Media" (done in
  `f99cbeb`), so "Library" means only the new page.

**How "don't ship coming soon" holds while building UI first:**
- Everything new is behind `NEXT_PUBLIC_OPENCMO_UI=v2`. Production leaves it unset until the release step (§5, U9).
  Preview and local set it. With the flag off the app is exactly today's.
- Sample data exists only in the fixture files of `lib/screens/` and is shown only while a screen's `live` flag is
  false, with the "Sample data" tag (the same rule as today's `workspace.ts` `demo` mode).
- Release turns on a screen only when its `live` flag is true in production. A screen that is still sample-only is
  hidden from the rail, not shown as "coming soon".

**Design source of truth:** the canvas https://claude.ai/artifact/QqAc6RuZi44osR3YAXAuNw, copied into
[`2026-10-27-app-redesign-frames/`](2026-10-27-app-redesign-frames/) (one `.dc.html` per artboard, plus
`canvas.json`). Copy exact values (sizes, colours, spacing) from those files; do not round them. To look at a screen, open `2026-10-27-app-redesign-frames/static/index.html` in a browser (plain HTML copies at
the initial state). The sample numbers in
the frames are not product data.

## 2. Screen list

| # | Screen | Route | Frame | Data contract | Goes live with |
|---|---|---|---|---|---|
| S1 | Shell: rail, credits, account; phone tab bar | `app/app/layout.tsx` (v2 branch) | every frame | `ShellAccount` (exists) + `pending` | U2 |
| S2 | Dashboard: week strip, team graph, live log, results, going out today, approval queue | `/app` | `Main.dc.html`, `DashboardPhone.dc.html` | `DashboardScreen` | brain A0 (queue), B1 (graph), B2 (log) |
| S3 | Approval cards, 10 kinds + 4 states + empty | inside S2; one card opens at `/app/inbox/[id]` | `Cards.dc.html` | `ApprovalCard` | A0 (post, reply, goal), A1 (Studio), P1 (schedule) |
| S4 | Analytics | `/app/analytics` | `Analytics.dc.html` | `AnalyticsScreen` | R3 (public X metrics now, Zernio later) |
| S5 | Brain: orders, memory, past weeks | `/app/brain` | `Brain.dc.html` | `BrainScreen` | B1 |
| S6 | Library: Business, Brand Kit, Voice, Skills | `/app/library` | `Library.dc.html` | `LibraryScreen` | U6 (data exists today) |
| S7 | Research | `/app/research` | `Research.dc.html` | `ResearchScreen` | live today (insights) |
| S8 | Writer | `/app/writer` | `Writer.dc.html` | `WriterScreen` | live today (X), W1 others |
| S9 | Studio (replaces My projects, Task U7b) | `/app/studio`, item drawer `?item=<id>` | `Studio.dc.html` | `StudioScreen` | uploads and edits live today; generated items with S1 |
| S10 | Sales | `/app/sales` | `Sales.dc.html` | `SalesScreen` | live today (scan), R1 rules |
| S11 | Schedule: calendar week/month/list, accounts, rules | `/app/schedule` | `Schedule.dc.html` | `ScheduleScreen` | P0–P1 |
| S12 | Settings: accounts, budget, timezone, email, brain mode, off switch | `/app/settings` (v2 branch) | `Settings.dc.html` | `SettingsScreen` | B0 (budget), P0 (accounts) |
| S13 | Setup: five steps | `/app/setup` (v2 replaces today's onboarding view) | `Setup.dc.html` | `SetupScreen` | live today (documents) |

## 3. What already exists (checked on this branch, 2026-10-27)

| Piece | Where | Use it for |
|---|---|---|
| Persistent shell with Realtime | `app/app/layout.tsx`, `components/clipping/web/WebShell.tsx`, `app/app/shell.ts` | S1: keep the pattern (shell in the layout, data read client-side through `api()`) |
| UI-first contract with `live` flags | `lib/cmo/workspace.ts`, `lib/cmo/load-workspace.ts` | the model for `lib/screens/*` |
| Realtime hook | `components/clipping/useLive.ts` | live log, counters, queue |
| Pixel robot | `components/landing/PixelBot.tsx`, `.lv-bot*` in `styles/landing.css` | team graph nodes |
| Approval actions | `components/cmo/workspace/actions.ts`, RPCs `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal` | S3 until A0's `approval_decide` |
| Documents | `lib/cmo/documents.ts`, `components/cmo/DocumentFields.tsx` | S6 Business, S13 |
| Brand Kit | `lib/brand.ts`, `components/brand/`, `/app/brand` | S6 Brand Kit |
| Skills | `packages/skills`, `editor_skills` (`lib/agent/skills.ts`) | S6 Skills |
| Metrics | `post_metrics`, `lib/cmo/jobs/pull-metrics.ts` | S4 |
| Tokens | `styles/design-system.css` (app, Lapis & Marble), `styles/landing.css` (Landing v4) | U1 |

## 4. Global constraints

- **One runtime, no new dependency for the graph or charts.** The team graph is absolutely placed CSS/SVG (as in
  `Main.dc.html`), the charts are CSS bars. No React Flow, no chart library.
- **Tokens are scoped.** v2 tokens apply under `html[data-ui="v2"]` and only on v2 screens. The editor keeps its
  current tokens in this plan; restyling the editor is a separate decision.
- **Data read client-side through `api()`**, under RLS, as today. No new service-role reads.
- **Accessibility as drawn:** real buttons and links, 44 px targets, 4.5:1 text (brand orange `#ef4a1a` is never text;
  text and filled buttons use `#c93a0f`), `prefers-reduced-motion` stops every animation.
- **Phone:** Dashboard and cards are phone-first (390 px); every page works at 390 px without horizontal page scroll.
- **English** in all user-facing text. No model names. Copy describes software.
- Fixtures are typed with the same zod schema as live data; `check:contracts` validates every fixture.

## 5. Todo list

### Task U0: Screen contracts and fixtures (Session A lands it; everyone codes against it)

- [ ] `apps/web/lib/screens/` with one file per screen: zod schema + TS type + `live` flags. Start from the frames:
  every number, label and list on a frame is a field.
- [ ] `apps/web/lib/screens/fixtures/` with one fixture per screen, built from the frames' sample content.
- [ ] `apps/web/lib/screens/screens.check.ts`: every fixture parses; added to `check:contracts`.
- [ ] `GET /api/v1/screens/[name]` returns `{ data, live }`: fixture when the flag is on and nothing is live, live data
  per field as loaders land. One route handler, a loader table keyed by screen name.
- [ ] Contract doc: `docs/plans/cmo/2026-10-27-screen-contracts.md`, a table per screen of field, source table/RPC,
  live today (yes/no), brain phase that makes it live.

### Task U1: Tokens and primitives (Session B)

- [ ] `styles/ui-v2.css`: the Landing v4 tokens as `--v2-*` under `html[data-ui="v2"]` (paper, paper2, paper3, ink,
  ink2, line, line2, char, brand, brand-deep, brand-soft, waiting text, ok, stuck; Inter + Source Code Pro;
  radius 4 and pill; mono label style). Values from `Tokens.dc.html`.
- [ ] Fonts: Source Code Pro is already self-hosted (`packages/clip-media/fonts/`, synced to `/fonts` by
  `media:sync`, used by `landing.css`); Inter as today. No Google Fonts link (CSP `font-src 'self'`).
- [ ] `components/ui/`: `Button` (primary, secondary, quiet, danger, on-dark), `Chip` (running, waiting, stuck, posted,
  scheduled, idle), `Tabs`, `Segmented`, `Panel` (header + body), `Kpi`, `MonoLabel`, `Toggle`, `Field` (input,
  select, textarea with label), `EmptyState`, `SampleTag`.
- [ ] `/app/design` (flag-only, not linked): every primitive in every state, for screenshots.
- [ ] Look: screenshot `/app/design` at 1440 and 390 and compare with `Tokens.dc.html`.

### Task U2: Shell (Session B)

- [ ] v2 branch in `app/app/layout.tsx`: `data-ui="v2"` on `<html>`, new `Rail` (Dashboard + count, Analytics, Brain,
  Library; Departments: Research, Writer, Studio, Sales with stuck dot, Schedule; Make: Editor; Settings; credits).
- [ ] Phone: bottom tab bar Today · Approve (count) · Calendar · More; More opens a sheet with the rest.
- [ ] Rail items whose screen is not live in production are hidden (reads `live` from the screens route).
- [ ] Keep the shell's Realtime channel and toast as today.

### Task U3: Dashboard (Session B)

- [ ] Header: live clock, headline from the queue count, Ask your CMO, Pause CMO (opens a confirm; wired in B2).
- [ ] Week strip: goal + progress, deliverables done, working now, words drafted, credits this week.
- [ ] `TeamGraph`: Brain hub + six department nodes at the frame's positions; robot states working (bob, blink),
  idle (grey, eyes closed), stuck (red, shake); packets along active wires; node status line and waiting chip.
  Horizontal scroll inside its panel below 800 px; the phone shows the list version instead.
- [ ] `LiveLog`: newest five events, `aria-live="polite"`.
- [ ] Results · last 7 days table with sparklines and the "Brain used this" line; Going out today table.
- [ ] Approval queue: one card open, the rest collapsed; approving removes the card, updates every count (rail badge,
  node chips, headline) and adds a log line. Optimistic, rolled back on error.
- [ ] Phone version from `DashboardPhone.dc.html`.
- [ ] e2e `ui-v2-dashboard.spec.ts` with fixtures: approve a card, counts drop, empty state shows at zero.

### Task U4: Approval cards (Session B)

- [ ] `components/cards/`: one `ApprovalCard` frame (head: department · kind; body; foot: price, account, time; one
  primary action) and ten bodies: post (platform tabs, versions, checks), reply (score, quotes, draft), goal + week
  plan, script, price, finished video, shorts batch, slideshow, schedule, correction.
- [ ] States: expired, decided elsewhere, needs credits, failed; empty queue.
- [ ] `/app/inbox/[id]`: one card full page (the digest and push links open it).
- [ ] Card actions call today's RPCs through `components/cmo/workspace/actions.ts` for post, reply and goal; the
  others are disabled with the reason until their phase.

### Task U5: Analytics and Brain (Session C)

- [ ] Analytics: range (7/30/90), account chips with sync status, the disconnected-account banner, six KPIs with
  deltas, stacked bars per day with "missing" days, the Brain panel, by-account table, posts against median.
  A dash means "not reported", never zero.
- [ ] Brain: tabs This week / Memory / Past weeks; orders table with nesting, credits used/budget, states; learned lately.

### Task U6: Library (Session C)

- [ ] Tabs Business (four documents, edit opens today's `DocumentFields`), Brand Kit (today's kit editor restyled,
  9:16 preview), Voice (notes, delete, words you cut), Skills (writing and video, toggles), Who reads what.
- [ ] Business and Brand Kit read live data now (documents and `brand_kits` exist); Voice and writing skills stay
  sample until brain B0/W1.
- [ ] `/app/brand` redirects to `/app/library?tab=brand` under the flag.

### Task U7: Department pages (Session C)

- [ ] Research: insights with source links and type filter, results table, link to Library documents.
- [ ] Writer: kind tabs, platform chips, four status columns, voice panel linking to Library.
- [ ] Studio: kind tabs (with Your uploads), search, favorites, sort, media grid (uploading with cancel, the item
  menu with Rename / Process again / Delete, (running with progress, price waiting, own edit with Mark finished, shorts batch,
  finished, slideshow, failed with refund note), video team progress panel. Open in editor goes to today's editor.
- [ ] Sales: mention meter, stuck banner, thread list with rule labels, thread detail with scores, quotes, editable
  draft, Copy and open thread / I replied / Dismiss with reason. No post button, ever.
- [ ] Schedule: Week / Month / List, platform chips, day columns with slots in all states, accounts and rules panels.
  Drag a slot to move it (opens a re-approval, disabled until P1).

### Task U7b: Studio replaces My projects (Session C; owner decision 2026-10-27)

Studio is the one place for everything the founder made or uploaded; the old projects pages go away. Nothing the
projects pages can do today may be lost.

- [ ] Parity with today's pages (`components/clipping/web/LibraryView.tsx`, `ProjectView.tsx`,
  `components/clipping/ProjectLibrary.tsx`): search, favorites filter and star, sort, rename, delete with the
  two-tap confirm, upload with progress and cancel, processing stages (`stageLabel`, `ProcessingView`), failed and
  cancelled with "Process again" / "Use another video", open in editor. All on the same API (`/api/v1/projects…`).
- [ ] Item drawer `?item=<id>`: status, the edits made from it, rename, delete, process again. It replaces
  `/app/projects/[id]`.
- [ ] Redirects (permanent, kept forever for bookmarks and old emails): `/app/projects` → `/app/studio`;
  `/app/projects/[id]` → `/app/studio?item=[id]`; `/app/jobs/[id]` → `/app/studio?item=[id]`;
  `/app/projects/[id]/clips/[clipId]/edit` keeps redirecting to `/app/editor/[clipId]`. Under the flag only until U9.
- [ ] Every link to the old pages points at Studio: `components/editor/EditorShell.tsx` (back link and `leave`),
  `components/editor/ClipPicker.tsx`, `components/editor/DeviceCheck.tsx`, `projectHref` in `ProjectLibrary.tsx`
  (move it to Studio), the `projects` rail entry in `components/clipping/web/WebShell.tsx`.
- [ ] e2e: port `e2e/projects-delete.spec.ts` and the project case of `e2e/isolation.spec.ts` to Studio.
- [ ] At release (U9), delete `LibraryView.tsx`, `ProjectView.tsx`, `ProjectLibrary.tsx`, the `library` skeleton
  variant and the `app/app/projects/` pages except the redirects; keep `ProcessingView`/`stageLabel` only if Studio
  uses them. Grep for every import before deleting.

### Task U8: Settings and Setup (Session C)

- [ ] Settings: accounts with status and reconnect, weekly budget, time zone, morning email, brain mode (OpenCMO /
  your Claude through MCP), the dark off-switch panel, links to Billing, Library › Brand Kit, API keys.
- [ ] Setup: five-step progress, documents step with today's `DocumentFields`, connect accounts step, Brand Kit step,
  first goal step. Replaces today's onboarding view under the flag.

### Task U9: Look check and release gate (lead: Session B; reviewer: the planning session)

- [ ] Screenshot every screen at 1440 and 390 with fixtures (`apps/web/e2e/ui-v2-look.spec.ts`), side by side with its
  frame, committed to `docs/plans/cmo/2026-10-27-ui-build-frames/`.
- [ ] Axe check on every screen: no serious violations.
- [ ] `npm run typecheck && npm run build`, `check:contracts`, e2e (old suite with the flag off, v2 suite with it on).
- [ ] Release is the owner's: turn the flag on in production only for screens whose `live` is true.

## 6. Review focus

- Sample data never reaches production users (flag off, or `live` false hides the screen).
- Counts agree everywhere (rail badge, headline, node chips, queue) after every action.
- Brand orange never used for text; reduced motion stops the robots and packets.
- No new service-role read; no new dependency.
