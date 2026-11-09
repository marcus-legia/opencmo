# CMO review 2: rules for the three sessions

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md).

- **One branch, one PR: `cmo-review-2`.** No session opens its own branch or PR. Pull before you start each item:
  `git pull origin cmo-review-2`. Commit and push each finished item right away; every commit is green on the checks
  of what it touches (CLAUDE.md "Working style").
- **Touch only what you own.** Your session file lists it. When you need a change in a file another session owns,
  write it under "Requests" in **that session's file**, then push. The owner of the file makes the change. Never edit
  it yourself.
- **Shared file: `apps/web/lib/agent/scope.ts`.**
  - S2 owns `clipScopeWith` and everything above `cmoScope`.
  - S3 owns `cmoScope` and everything below it.
  - Neither moves code across that line.
- **Migrations:** only S3 writes them, with timestamps from `20270111010000` up. S3 regenerates
  `supabase/schema/current.sql` with `scripts/dump-schema.sh`. If S2 needs SQL, it goes to S3 as a request.
- **Research before code.** Each item starts with a short note at the top of your file:
  - what the code does now (`file:line`);
  - what you will change;
  - how you will check it.

  CLAUDE.md: "Each item gets its own research and plan before it is built".
- **Product rules apply to every line:**
  - charge before running, then run in one go;
  - assist, never act;
  - every word a person reads goes through no-ai-slop;
  - no "coming soon" in the UI or on the landing page;
  - English in the repo.
- **Done:** tick the box and add the commit hash. The last session to finish updates the PR description.
- **Conflicts:** if `git pull` brings in a conflict inside a file you own, resolve it. If the conflict is in a file
  you do not own, stop and write a request to its owner.
