# Wave 4 — sessions

Plan: [`../2026-11-20-wave4-plan.md`](../2026-11-20-wave4-plan.md). One branch: `claude/launch`. Commit and push after
each task; never merge, deploy or force-push.

| Session | File | 4a (before launch) | 4b (after launch) |
|---|---|---|---|
| A: data and SQL | [A.md](A.md) | A1 usage state · A2 delete account | A3 drop hidden tables · A4 quote card data |
| B: jobs, ops, quality | [B.md](B.md) | B1 scan quality · B2 health and alerts · B3 Feed reach level | B4 delete hidden jobs · B5 quote card render · B6 email links |
| C: UI and e2e | [C.md](C.md) | C1 phone layout · C2 states · C3 delete account · C4 copy · C5 e2e, 4a PR | C6 delete hidden UI · C7 quote card, email buttons · C8 e2e, 4b PR |

**4b waits:** do not start a 4b task until the 4a PR is merged and the owner writes "4b go" in that session.

Before each task: `git pull --rebase origin claude/launch` (rebase unpushed commits only). Touch only your files; a
request for another session goes under **Requests** in that session's file, in its own commit. The three owner
decisions are in the plan with their defaults: build the default unless the owner has said otherwise.
