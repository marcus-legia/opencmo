# P4 work split: three sessions, one branch, one PR

Plan: [`../2026-10-28-p4-schedule-publish-plan.md`](../2026-10-28-p4-schedule-publish-plan.md). Read it first; this folder says who
does what. **Branch `cmo-p4`, PR into `cmo-build`; every session works there.** No session opens its own branch or PR.

**Before any session starts:** the phase before this one has merged into `cmo-build`, the planner has merged
`cmo-build` into this branch and refreshed the plan's §3 from what was actually built.

| Session | File | Builds | First push (others wait on it) |
|---|---|---|---|
| **A** (lead) | [`A.md`](A.md) | SQL for accounts, slots, schedule cards, firing and webhook status; loaders; acceptance | A0 contracts |
| **B** | [`B.md`](B.md) | publish adapter (Zernio + fake), connect routes, `publish_post` handler, `publish_media` worker task, webhook route | B0 adapter interface |
| **C** | [`C.md`](C.md) | schedule card, Settings → Accounts and Schedule page live, copy, e2e | — (starts on A0's types) |
| **Planner** | — | reviews M1, M2, M3 and the PR before it merges into `cmo-build` | — |

## Rules

1. **Own your paths** (in your file). Anything else: write a request in the owner's file under "Requests", never edit
   it yourself.
2. **One branch, no force.** `git pull --rebase origin cmo-p4` before every push; never `--force`, never rebase pushed
   commits, never push to `cmo-build` or `main`, never merge the PR.
3. **Commit and push as you go**, prefixed `[A]`, `[B]` or `[C]`, each green on its own (typecheck plus the tests of
   what it touches). Nothing stays only in your session.
4. **Tick only your own file.** Checklists and requests live per session, so no two sessions edit the same file.
5. **Contracts first.** Each session's Task 0 is small and pushed first; nobody builds on a contract before it is
   pushed, and a contract changes only through a request its owner accepts.
6. **Migrations belong to A**; A regenerates `supabase/schema/current.sql`. Migration names for this phase start with
   the prefix in the plan's §4, so they sort after the previous phase.
7. Heavy suites one at a time on one machine; real providers cost money and run only in the acceptance task, once,
   with the owner's go-ahead; no deploys.
8. At each milestone A posts one PR comment "M1 ready for review" (M2, M3) with commits and screenshots.

## Shared files (named blocks, one owner each)

| File | Block | Owner |
|---|---|---|
| `apps/web/package.json` | `check:contracts` additions | A |
| `apps/web/package.json` | e2e list | C |
| `apps/web/lib/screens/approval-card.ts` | schedule card snapshot type | A |
| `packages/contracts/task-kinds.json` | the `publish_media` row | A (B writes the handler) |
| `packages/engine/modal_app.py` | the `schedule_claim_due` call in `sweep()` | A |
| landing copy (`apps/web/app/page.tsx` and its components) | the posting sentences only | C |

## Prompts to start each session

Paste one into a new Claude Code session on this repository.

**Session A**
> You are Session A of `docs/plans/cmo/2026-10-28-p4-sessions/`. Read `README.md` and `A.md` there, the plan
> `docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md`, and `docs/architecture/schedule-publish.md` and `approval.md` §5–§6. Work on branch `cmo-p4` (PR into `cmo-build`).
> Do A0 and push it first, then the rest of `A.md` in order. Tick only `A.md`; commit and push as you go.

**Session B**
> You are Session B of `docs/plans/cmo/2026-10-28-p4-sessions/`. Read `README.md` and `B.md` there, the plan
> `docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md`, and `docs/architecture/schedule-publish.md` §4–§8 and Zernio's public docs (read only). Work on branch `cmo-p4` (PR into `cmo-build`).
> Do B0 and push it first, then the rest of `B.md` in order. Call the real Zernio API only after the owner gates in the plan's §6 are done. Tick only `B.md`; commit and push as you go.

**Session C**
> You are Session C of `docs/plans/cmo/2026-10-28-p4-sessions/`. Read `README.md` and `C.md` there, the plan
> `docs/plans/cmo/2026-10-28-p4-schedule-publish-plan.md`, and the frames `Schedule.dc.html`, `Settings.dc.html` and `Cards.dc.html` in `docs/plans/cmo/2026-10-27-app-redesign-frames/`. Work on branch `cmo-p4` (PR into `cmo-build`).
> Start C0 once A0 is pushed, then the rest of `C.md` in order. Tick only `C.md`; commit and push as you go.
