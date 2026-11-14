# Sales finder v1 — sessions

Plan: [`../2026-11-14-sales-finder-plan.md`](../2026-11-14-sales-finder-plan.md). One branch, one PR:
`claude/sales-finder` → `main`. Commit and push after each task; never merge, deploy or force-push.

| Session | File | Tasks | Starts when |
|---|---|---|---|
| A — data and finders | [A.md](A.md) | A1 shared types · A2 SQL · A3 finders · A4 review | now; A1 first |
| B — the scan job | [B.md](B.md) | B1 multi-platform scan · B2 price card + eval · B3 review | A1 pushed |
| C — chat, screen, docs | [C.md](C.md) | C1 chat · C2 screen · C3 owner run · C4 whole-PR review + docs · C5 review | A1 pushed (C2 after A2 and B2) |

Before each task: `git pull --rebase origin claude/sales-finder` (rebase your unpushed commits only; never force-push).
A request for another session goes under **Requests** in that session's file, in its own commit.
