# Brain first, then the departments: implementation plan

> **For agentic workers:** §2 says *what* ships, §5 says *how*, task by task, with checkbox steps. Wave 1 (§5) is built
> now by three sessions in parallel with the UI plan; waves 2 and 3 (§6) each get their own detailed plan before code,
> as the repo requires. Work split: [`2026-10-27-cmo-build-sessions.md`](2026-10-27-cmo-build-sessions.md).
>
> **Scope:** read §0 of the sessions file first. This plan set builds 100% of the designed UI (sample data until live)
> and about 15% of the backend (brain B0–B2 and approval A0); it is not the whole system.

## 1. Goal and decisions

**Goal:** one brain that plans the week, hands work orders to every department, waits on the founder only through
approval cards, and learns from results. It runs with no browser open (Modal clock → Vercel brain → Supabase rows →
Modal worker), and every screen of the UI plan reads its live state.

**Owner decisions (2026-10-27):** brain first, then the departments; UI down; the brain owns plan, orders and what it
learns; documents, Brand Kit, voice and skills live in the shared Library (`docs/architecture/brain.md` §8b); every
platform posts through Zernio; the Dashboard is the only approval queue.

**Architecture:** [`docs/architecture/brain.md`](../../architecture/brain.md) (design, work orders §6, registry §7,
Studio §7b, memory §8, Library §8b, gates §9, phases §11), [`approval.md`](../../architecture/approval.md),
[`workflow.md`](../../architecture/workflow.md), and the department pages next to them. This plan does not restate
them; it orders the work and names the files.

## 2. What ships, by wave

| Wave | Phases | The founder sees | Screens it makes live |
|---|---|---|---|
| **1** (now) | B0 corrections + budget · A0 approvals table · B1 work orders + deliverables · B2 progress check, kill switch, digest | one queue for every card; the week plan as orders; the team graph and log moving on real data; Pause CMO works; the morning digest in the app | Dashboard (queue, graph, log), Brain, Library (Business, Brand Kit), Settings (budget, off switch) |
| **2** | A1 Studio cards · B3 registry + event rules + Studio adapter · S1–S2 Shorts · W0–W1 Writer · P0–P1 Zernio + schedule | the brain briefs Studio; video cards and the shorts batch in the queue; other platforms drafted; posts going out at approved times | Studio, Writer, Schedule, Setup accounts step, Library Voice + Skills |
| **3** | R0–R2 Research + Sales safety · P2–P3 best time + Zernio metrics · S3 Slideshow · A2–A3 phone, schedule cards with expiry · B4 brain evals · S4 look check | analytics from every account; subreddit rules; slideshows; brain quality measured | Analytics (all accounts), Sales rules, the rest |

## 3. What already exists (`supabase/schema/current.sql`, this branch)

- Queue `cmo_runs` (kinds `onboard`, `plan_week`, `post_draft`, `sales_scan`, `competitor_research`, `pull_metrics`,
  `summarize_memory`, `review_week`; statuses `queued`, `running`, `done`, `failed`; lease, attempt, `not_before`,
  `credits`), `cmo_enqueue`, `cmo_defer_run`, runner in `lib/cmo/jobs/`, cron `/api/cron/cmo`, Modal sweep.
- Decisions: `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`; pending count `lib/cmo/pending.ts`.
- Memory: `marketing_documents`, `cmo_memories`, `cmo_lessons`, `cmo_goals`; `classify-edits.ts`.
- Latest migration `20261226100000_long_take_quality.sql`, latest pgTAP `200_long_take_quality.test.sql`: new
  migrations sort after it.

## 4. Global constraints

- Every write goes through an ownership-checking RPC; money only through `credit_hold` / `credit_settle` /
  `credit_refund` / `credit_held`; every migration has a pgTAP test; regenerate `supabase/schema/current.sql`.
- Never edit an applied migration; explicit grants on new tables; RLS on every new table (read own rows).
- Outbound (posting, replying) only after an approval row says so; the brain never posts.
- Realtime: new tables the UI listens to are added to the `supabase_realtime` publication with RLS.
- English in SQL `raise exception`, `jobs.error` and route errors.

## 5. Wave 1 todo list

### Task W1-0: Baseline (Session A)

- [ ] `npm run db:reset && npm run db:test`, `npm run typecheck`, `check:contracts`: record the counts in the PR.

### Task W1-1: B0 corrections and budget (Session A)

- [ ] Migration `*_brain_b0.sql`: `cmo_corrections` (user, rule text ≤ 200, source edits jsonb, status
  `proposed|active|rejected`, created_at) with RLS read-own; RPC `cmo_decide_correction(id, action, text)`.
- [ ] `profiles`: `weekly_credit_budget int` (default from the plan), `timezone text` (IANA, validated),
  `digest_hour smallint`; RPC `save_cmo_settings`.
- [ ] Every job reads active corrections first, tier 0 of memory (next to the lessons read in `lib/cmo/jobs/store.ts`).
- [ ] pgTAP: ownership, status transitions, budget bounds, timezone check.

### Task W1-2: A0 one approvals table (Session A)

- [ ] Migration `*_approvals.sql`: `approvals` (id, user, kind enum of the 10 card kinds, ref_kind, ref_id, status
  `waiting|approved|edited|skipped|expired|cancelled`, snapshot jsonb with JCS `content_hash`, `price_credits`,
  `post_at`, `account`, created_at, decided_at, decided_via `app|email|push|mcp`).
- [ ] `approval_decide(id, action, payload)`: checks owner and snapshot hash, then calls `cmo_decide_post` /
  `cmo_decide_opportunity` / `cmo_decide_goal` / `cmo_decide_correction` in the same transaction.
- [ ] Today's post, reply and goal writers insert an approval row (backfill the waiting ones in the migration).
- [ ] `pending.ts` counts `approvals` where waiting; Realtime on `approvals`.
- [ ] pgTAP per transition; a decided card cannot be decided twice; a changed snapshot refuses.

### Task W1-3: B1 work orders and deliverables (Session A)

- [ ] Migration `*_work_orders.sql`: `work_orders` (id, user, root_id, parent_id, depends_on uuid[], department
  `research|writer|studio|sales|schedule|publish`, kind, brief jsonb `{objective, output, sources, boundaries,
  done_when}`, budget_credits, spent_credits, due_at, status `queued|running|waiting_founder|waiting_order|deferred|
  done|failed|cancelled`, error jsonb `{code, message, retryable, repair_hint}`, run_id → `cmo_runs`).
  `deliverables` (id, user, order_id, kind `post|caption|video|short|slideshow|reply|insight|metric`, ref_kind,
  ref_id, status). RLS read-own; Realtime on both.
- [ ] `plan_week` writes a tree of orders (root = the week); each order that maps to an existing kind enqueues its
  `cmo_runs` row through `cmo_enqueue`; the run's finish updates the order (one trigger or the runner).
- [ ] `work_order_events` (append-only: order, at, kind, text ≤ 200) for the live log.
- [ ] pgTAP: transitions, `depends_on` blocks start, spent never exceeds budget without a card.

### Task W1-4: B2 progress check, kill switch, digest (Session A)

- [ ] Daily progress check (code only, from the existing Modal clock): done / stuck / over budget / waiting on the
  founder; a stuck order gets one replan through the Planner, never a loop.
- [ ] Kill switch: `profiles.cmo_paused_at`; `cmo_enqueue` and the runner refuse while paused; Pause/Resume RPCs; every
  waiting order and run stops within a minute (the sweep reads the flag).
- [ ] Morning digest content at `digest_hour` local time: what waits (links open `/app/inbox/[id]`, never decide),
  what went out, what is stuck. Wave 1 shows it in the app (Dashboard) and in Inbucket locally through a
  `sendDigest` interface; the real email provider is chosen in A2 (there is no email provider in the stack today
  besides Supabase Auth mail), so production email waits for the owner's account.
- [ ] pgTAP for pause; a unit check for the progress classifier.

### Task W1-5: Screen loaders (Session A, after each task above)

- [ ] Fill `lib/screens` loaders for Dashboard (queue from `approvals`, graph from `work_orders` grouped by
  department, log from `work_order_events`, week strip from `cmo_goals` + orders + credit ledger), Brain (order tree,
  corrections, lessons), Library (documents, `brand_kits`), Settings (budget, timezone, digest, paused).
- [ ] Flip each field's `live` flag as it reads real rows; the UI does not change.

### Task W1-6: Wave 1 acceptance (lead: Session A; reviewer: the planning session)

- [ ] On a local stack with fake providers: onboard → plan_week writes a tree → posts and the Reddit scan run → cards
  appear in the Dashboard queue live → approve one, the graph and log move → Pause stops the next run → the digest lists
  what waits.
- [ ] Look: screenshots of the Dashboard and Brain with live data, next to their frames.

## 6. Waves 2 and 3 (outline; each gets its own plan before code)

- **A1** Studio cards (`price`, `finished_video`, `shorts_batch`, `slideshow`) share the Assistant's card components.
- **B3** capability registry JSON in `packages/contracts`; event rules (video approved → shorts order; short approved
  → schedule order; due → publish order; posted + 24 h → measure order); Studio adapter extracted from MCP's studio
  group (`build_video`, `cut_clips`), user JWT.
- **S1–S2** finished state on edits, named-timeline export, Shorts squad (3 shorts from a finished edit).
- **W0–W1** No AI Slop as guidance, post rules, platform profiles, voice notes into the Library.
- **P0–P1** Zernio checks (TikTok audit, price, terms), connect flow, `schedule_slots`, posting at the approved time
  through the worker, signed webhooks.
- **R0–R2** ScrapeCreators terms, Sales safety, niche video research; **P2–P3** best time, Zernio analytics;
  **S3** Slideshow and post images; **A2–A3** phone-first queue, push, schedule cards with expiry; **B4** brain evals;
  **S4** look check.
