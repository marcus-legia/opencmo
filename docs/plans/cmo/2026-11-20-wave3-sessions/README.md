# Wave 3 — sessions

Plan: [`../2026-11-20-wave3-plan.md`](../2026-11-20-wave3-plan.md). One branch: `claude/launch`. Commit and push after
each task; never merge, deploy or force-push.

| Session | File | Tasks | Starts when |
|---|---|---|---|
| A: data and SQL | [A.md](A.md) | A1 contract · A2 Library · A3 people and reach · A4 documents v2 · A5 cadence and funnel · A6 competitors by URL | after #238 merges; A1 first |
| B: jobs and prompts | [B.md](B.md) | B1 scan → Library + reach · B2 DM drafts, nudges · B3 posts from Library · B4 onboarding v2, voice · B5 cadence, Today · B6 follow-up re-reads · B7 Research chat · B8 weekly report, push | A1 pushed; each task names its A task |
| C: UI and e2e | [C.md](C.md) | **C0 now** (wave 2's red e2e) · C1 Library · C2 Post sources · C3 Your business · C4 reach out, Following up · C5 Research · C6 funnel · C8 Research chat, states, tracking · C7 review | C0 now; the rest after #238 merges and A1 |

**C0 comes first and lands in PR #238**: five e2e specs fail on it (Setup and activation wait for "Start with your
website." while Setup now starts on its own with `?site=`). When #238 is green and merged, wave 3 begins.

Before each task: `git pull --rebase origin claude/launch` (rebase unpushed commits only). Touch only your files; a
request for another session goes under **Requests** in that session's file, in its own commit.
