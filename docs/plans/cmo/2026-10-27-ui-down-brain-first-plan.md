# UI down, brain first: the plan to build the AI CMO

Status: **proposed** (2026-10-27), for the owner's review. Markdown twin of
[`2026-10-27-ui-down-brain-first-plan.html`](2026-10-27-ui-down-brain-first-plan.html). Built on
[`docs/architecture/workflow.md`](../../architecture/workflow.md) and the department pages next to it. The screen list
for the designer is [`2026-10-27-ui-design-brief.md`](2026-10-27-ui-design-brief.md).

## 1. Owner direction (2026-10-27)

- **Build the brain first**, then the rest of the system.
- **Work top-down**, from the whole system to the details.
- **Start from the UI:** redesign the whole app in Claude Design. The finished design is the goal every build phase
  works toward.

## 2. Advisor view

| Point | View |
|---|---|
| UI as the goal | **Agree.** Each screen names the data it shows and the actions it offers. That becomes the contract for tables, RPCs and jobs, so nothing gets built that no screen uses. Today's CMO screen already works this way (`lib/cmo/workspace.ts` with `live.*` flags). |
| Brain first | **Agree, with one condition.** The brain is the spine every department plugs into, and it can be tested on departments that already exist: X posts, the Reddit scan, competitor research, goals and the long take. This changes the owner decision of 2026-10-19 ("the editor is the spearhead"), so the Strategy section of `CLAUDE.md` changes with this plan (§7). |
| The one exception | Finish **Studio S0** (long take on production, PR #111) alongside the design work. It is nearly done, it is the first real OpenCMO marketing video, and it gives the brain a real Studio to brief in B3. |
| Redesign scope | **Everything except the inside of the editor.** The editor has its own parity work and shortcuts. Redesigning it now would put the brain off by weeks. The editor gets the new design tokens and an entry point from Studio; a redesign inside it comes later. |
| Claude Design output | **A target, not code to paste.** We rebuild the screens with our own components and routes, with the same tokens. The design must show real states: empty, loading, waiting on the founder, failed, out of credits. Those states are where the contracts come from. |
| Risk | Design without data drifts into features we cannot back (the rule is "don't ship coming soon"). Each screen is tagged with the phase that makes it live. The app shows only the screens whose phase has shipped. |

## 3. Phases, top-down

| Phase | Level | What | Who | Output | Gate |
|---|---|---|---|---|---|
| **U0** | System | Product map: sitemap, the screen list, the states of each screen, the card kinds, taken from `workflow.md` | Claude | the design brief (done with this plan) | the owner approves the screen list |
| **U1** | System | Design system in Claude Design: colours, type, spacing, components (rail, card, table, drawer, status chips, empty states), light and dark, phone width | owner in Claude Design; Claude reviews | design system | the owner approves |
| **U2** | Screens | The whole app in Claude Design, in workflow order: shell and Home → Inbox (10 card kinds) → Week → Departments → Activity → Memory → Setup → Settings and billing | owner; Claude reviews against the contracts | every screen, every state | design frozen (changes after this go through the plan) |
| **U3** | Contracts | For each screen: data, actions, live phase → the tables, RPCs, jobs and API routes it needs; diff against today's code | Claude | `screen-contracts.md`; the architecture pages updated | the owner approves |
| **B0–B3 + A0–A2** | Brain | Brain and Approval, built against U3 and wired to the departments that exist (section 4) | Claude sessions | brain live; new shell, Home, Inbox, Week, Activity | **one real week runs**: plan → posts → Reddit → research → measure, the founder only approves |
| **D1–D4** | Departments | One department at a time, in workflow order (section 5) | Claude sessions | each department's screen live with real output | a real deliverable per department |
| **Q** | Quality | Brain evals B4, Studio look check S4, best time P2, metrics P3, Research R3–R4, Writer W4 | Claude sessions | measures on the dashboard | targets set from real weeks |

S0 runs in parallel with U1–U3.

## 4. Brain phase in detail

Each step ships its slice of the new UI together with the backend, so the step is visible as soon as it lands.

| Step | Backend | UI slice | Uses departments that exist |
|---|---|---|---|
| **B0** | corrections, budget fields (`brain.md` §9) | Settings: weekly budget, kill switch placeholder hidden until B2 | — |
| **A0** | `approvals` + `approval_decide` wrapping today's RPCs; `pending.ts` reads it | new shell and **Inbox** with `post`, `reply`, `goal` cards | Writer (X), Sales, goals |
| **B1** | `work_orders` from `cmo_runs`, deliverables; `plan_week` writes a tree | **Week**: plan and work order tree; **Activity**: order log | competitor research, X drafts, Reddit scan |
| **A1** | snapshot rule; Studio cards (`price`, `finished_video`) | Inbox: Studio cards | long take (S0) |
| **B2** | progress check, kill switch, morning digest (cron) | **Home / Today**: waiting, progress, stuck orders, kill switch | all of the above |
| **A2** | digest email (Resend), web push, phone-first inbox | Inbox at phone width | — |
| **B3** | capability registry, event rules, Studio adapter (`build_video`, `cut_clips`) | Activity shows which department got which order | long take via the adapter |

**Gate:** one real week on a test account and on OpenCMO's own account. The brain plans; X drafts, the Reddit scan
and research run on their own; the founder only approves. Measures: cards per day, approval rate, edit rate, credits
per approved deliverable, stuck orders.

## 5. Departments, in workflow order

Each department follows the same steps: frozen screen → its contract → build → a real deliverable.

| # | Department | Phases | Screen | Real deliverable |
|---|---|---|---|---|
| D1 | Writer | W0, W1, W2 (other platforms, voice memory, captions) | Writer: drafts per platform, voice notes | a week of OpenCMO posts on X, Threads, LinkedIn |
| D2 | Studio | S1, S2, S3 (adapter, Shorts, Slideshow, post images); A1 cards | Studio: videos, shorts, slideshows; opens the editor | one OpenCMO video, its 3 shorts, one slideshow |
| D3 | Schedule + Publish | P0, P1; A3 `schedule` cards | Week calendar with slots; Settings: accounts, timezone | posts going out at approved times through Zernio |
| D4 | Research + Sales | R0, R1, R2 | Research: insights with URLs; Sales: threads and replies | a niche video brief; replies posted by hand |

## 6. What this replaces on the roadmap

- `docs/plans/editor/2026-10-19-editor-spearhead-roadmap.md` E1–E6 wait until D2. S0 stays.
- Growth and billing (referral, rewards, cancel flow) still come after, as before.
- Every phase still gets its own plan in `docs/plans/` before code, as before.

## 7. Changes that come with this plan

- `CLAUDE.md` Strategy: "brain first, UI down (owner, 2026-10-27)"; the editor stays what we sell, and S0 keeps
  producing the marketing video.
- `docs/architecture/workflow.md` build order: replaced by sections 3–5 here.

These two edits are made when the owner approves this plan, not before.

## 8. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Brain first, changing the 2026-10-19 spearhead decision | yes, with S0 kept in parallel |
| 2 | Redesign scope | the whole app except the inside of the editor |
| 3 | Design system: keep Lapis & Marble or start fresh | let Claude Design propose; keep the lapis accent if it still fits |
| 4 | Who drives Claude Design | the owner drives; Claude writes the brief and reviews every screen against the contracts |
| 5 | Phone | Inbox and Home designed phone-first (approvals happen on the phone); the rest desktop-first |
