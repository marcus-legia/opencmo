# CMO review 3: rules for the three sessions

Plan: [`../2026-11-09-cmo-review-3-plan.md`](../2026-11-09-cmo-review-3-plan.md).

- **One branch, one PR: `cmo-review-3`.** No session opens its own branch or PR. Before each item, pull:
  `git pull origin cmo-review-3`. Commit and push each finished item right away. Every commit is green on the checks
  of what it touches (CLAUDE.md "Working style").
- **Touch only what you own.** Your session file lists it. If you need a change in a file another session owns, write
  it under "Requests" in **that session's file** and push. The session that owns the file makes the change.
- **Order:** A pushes `apps/web/lib/cmo/script.ts` (types and helpers) and its RPCs first. B and C start on fixtures
  and switch to A's helpers once they are pushed. Nobody writes a second copy of them.
- **Shared file `components/editor/EditorShell.tsx`:** B owns only the tab list and the Script panel's mount.
- **Migrations:** only A writes them, with timestamps from `20270113010000` up. A regenerates
  `supabase/schema/current.sql` with `scripts/dump-schema.sh`. Every migration gets a pgTAP test.
- **Research before code.** Each item starts with a short note at the top of your file:
  - what the code does now (`file:line`);
  - what you will change;
  - how you will check it.

  When you learn from another product or repo (Descript scenes, a teleprompter app), cite it. Copy code only under
  MIT, BSD or Apache-2.0, with a notice in `THIRD_PARTY_NOTICES.md`.
- **Product rules apply to every line:**
  - charge before running;
  - assist, never act (I3 proposes a cut and never applies it alone);
  - upload is the only way video comes in;
  - no-ai-slop on every word a person reads;
  - no "coming soon";
  - English in the repo.
- **Done:** tick the box with the commit hash. The last session to finish updates the PR description.
