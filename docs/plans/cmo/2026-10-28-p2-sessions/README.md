# P2 work split: three sessions, one branch, one PR

Plan: [`../2026-10-28-p2-studio-brain-plan.md`](../2026-10-28-p2-studio-brain-plan.md). Read it first; this folder says
who does what. **Branch `cmo-p2`, PR into `cmo-build`; every session works there.** No session opens its own branch or
PR.

| Session | File | Builds | First push (others wait on it) |
|---|---|---|---|
| **A** (lead) | [`A.md`](A.md) | SQL, brain orders and event rules, registry, loaders, acceptance | A0 contracts |
| **B** | [`B.md`](B.md) | Studio adapter, video brief, short render, Shorts squad | B0 adapter interface |
| **C** | [`C.md`](C.md) | Studio cards live, Mark finished, Studio page live, e2e | — (starts on A0's types) |
| **Planner** | — | reviews M1, M2, M3 and the PR before it merges into `cmo-build` | — |

## Rules

1. **Own your paths** (in your file). Anything else: write a request in the owner's file under "Requests", never edit
   it yourself.
2. **One branch, no force.** `git pull --rebase origin cmo-p2` before every push; never `--force`, never rebase pushed
   commits, never push to `cmo-build` or `main`, never merge the PR.
3. **Commit and push as you go**, prefixed `[A]`, `[B]` or `[C]`, each green on its own (typecheck plus the tests of
   what it touches). Nothing stays only in your session.
4. **Tick only your own file.** Checklists and requests live per session, so no two sessions edit the same file.
5. **Contracts first.** A0 and B0 are small and pushed first; nobody builds on a contract before it is pushed, and a
   contract changes only through a request its owner accepts.
6. **Migrations belong to A**; A regenerates `supabase/schema/current.sql`. **Editor-core ops belong to B.**
   **`components/cards/` and `components/screens/studio/` belong to C.**
7. Heavy suites one at a time on one machine; real providers cost money and run only in A6, once, with the owner's
   go-ahead; no deploys.
8. At each milestone A posts one PR comment "M1 ready for review" (M2, M3) with commits and screenshots.

## Shared files (named blocks, one owner each)

| File | Block | Owner |
|---|---|---|
| `apps/web/package.json` | `check:contracts` additions | A |
| `apps/web/package.json` | e2e list | C |
| `packages/mcp-server/src/groups/studio.ts` | the whole file (it becomes a thin caller of the adapter) | B |
| `apps/web/lib/screens/approval-card.ts` | Studio card snapshot types | A |
| `apps/web/components/editor/TopBar.tsx` | the Mark finished button only | C |

## Prompts to start each session

Paste one into a new Claude Code session on this repository.

**Session A**
> You are Session A (lead) of `docs/plans/cmo/2026-10-28-p2-sessions/`. Read `README.md` and `A.md` there, the plan
> `docs/plans/cmo/2026-10-28-p2-studio-brain-plan.md`, and `docs/architecture/brain.md` §6–§7b and `approval.md`.
> Work on branch `cmo-p2` (PR into `cmo-build`). Do A0 and push it first, then the rest of `A.md` in order. Tick only
> `A.md`; commit and push as you go.

**Session B**
> You are Session B of `docs/plans/cmo/2026-10-28-p2-sessions/`. Read `README.md` and `B.md` there, the plan
> `docs/plans/cmo/2026-10-28-p2-studio-brain-plan.md`, and `docs/architecture/studio.md` and `brain.md` §7b. Work on
> branch `cmo-p2`. Do B0 and push it first, then the rest of `B.md` in order. Tick only `B.md`; commit and push as
> you go.

**Session C**
> You are Session C of `docs/plans/cmo/2026-10-28-p2-sessions/`. Read `README.md` and `C.md` there, the plan
> `docs/plans/cmo/2026-10-28-p2-studio-brain-plan.md`, and the frames `Cards.dc.html` and `Studio.dc.html` in
> `docs/plans/cmo/2026-10-27-app-redesign-frames/`. Work on branch `cmo-p2`. Start C0 once A0 is pushed, then the rest
> of `C.md` in order. Tick only `C.md`; commit and push as you go.
