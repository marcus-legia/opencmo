# Free scan — sessions

Plan: [`../2026-11-18-free-scan-plan.md`](../2026-11-18-free-scan-plan.md). One branch, one PR:
`claude/free-scan` → `main`. Commit and push after each task; never merge, deploy or force-push.

| Session | File | Tasks | Starts when |
|---|---|---|---|
| A — SQL and jobs | [A.md](A.md) | A1 contract · A2 SQL · A3 free scan without drafts · A4 onboarding queues the scan · A5 reply drafts job | now; A1 first |
| B — app screens (v2) | [B.md](B.md) | B1 loader · B2 cards without drafts · B3 fit verdict · B4 Setup leads to Sales | A1 pushed |
| C — copy, e2e, owner run | [C.md](C.md) | C1 copy · C2 e2e · C3 owner run + whole-PR review | C1 after A1; C2 after A4 and B4 |

Before each task: `git pull --rebase origin claude/free-scan` (rebase your unpushed commits only; never force-push).
Touch only the files your session owns. A request for another session goes under **Requests** in that session's file,
in its own commit.
