# CMO review 3: sessions

Plan: [`../2026-11-09-cmo-review-3-plan.md`](../2026-11-09-cmo-review-3-plan.md).

Branch: `claude/okara-spec-opencmo-b7qlx2`, with one PR to `main`. No session opens its own branch or PR.

## Phase 1 (now): groups 1–3

| Session | File | Items | Waits on |
|---|---|---|---|
| A: Post card and voice | [`A-post-voice.md`](A-post-voice.md) | 1.2 → 2.1 → 2.2 → 2.3 | B0 before A3 |
| B: Today and the first run | [`B-today-first-run.md`](B-today-first-run.md) | B0 → 1.1 → 1.3 → 3.1 → 3.2 → 3.3 → 3.4 | nothing |

- **B0 is built once, first:** `cmo_require_paid`, the 402 `plan_required` mapping, `PlanSheet.tsx` and the `today`
  contract.
- **The SQL functions** each have one owner (plan §6). A session that needs a change in the other's function writes a
  request in that session's file.
- **Migration ranges:** A `20270113…`, B `20270114…`.
- **pgTAP ranges:** A `276`–`285`, B `286`–`295`.
- **`supabase/schema/current.sql`** is regenerated after a rebase, never merged by hand.
- **Every group ends with `/code-review high`** and the write-up in the session file (plan §7). The reviewer reviews
  the PR after both sessions finish.

## Phase 2 (after phase 1 is reviewed): group 4

[`phase-2/`](phase-2/) holds the first draft's sessions for the script items (I0, I1, I3; I2 is on `main`). The
reviewer re-checks them against `main` before phase 2 starts.
