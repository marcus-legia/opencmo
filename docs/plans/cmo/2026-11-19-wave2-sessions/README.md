# Wave 2 — sessions

Plan: [`../2026-11-19-wave2-plan.md`](../2026-11-19-wave2-plan.md). One branch, one PR: `claude/ui-redesign` → `main`
(PR #237). Commit and push after each task; never merge, deploy or force-push.

| Session | File | Tasks | Starts when |
|---|---|---|---|
| A: SQL and billing | [A.md](A.md) | A1 contract · A2 usage + pause · A3 free reply drafts, second free scan · A4 email settings and log · A5 annual row | now; A1 first |
| B: email and jobs | [B.md](B.md) | B1 digest content · B2 schedule, skip, log · B3 no expiring emails, autopilot push | A1 pushed; B2 after A4 |
| C: UI, copy, e2e | [C.md](C.md) | C1 usage chip · C2 hide prices · C3 notifications page · C4 chat folds · C5 FAQ · C6 review | C4, C5 now; C1, C2 after A2; C3 after A4 and B2 |

Before each task: `git pull --rebase origin claude/ui-redesign` (rebase unpushed commits only). Touch only your files;
a request for another session goes under **Requests** in that session's file, in its own commit.
