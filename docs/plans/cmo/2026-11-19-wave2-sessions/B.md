# Session B — email and jobs

Plan: [`../2026-11-19-wave2-plan.md`](../2026-11-19-wave2-plan.md). Branch `claude/launch`. The target is the
canvas board "Proposed: morning email" (https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ); "Email today" shows what
to remove.

**Owns:** `apps/web/lib/cmo/digest.ts` (+ `digest.check.ts`), `apps/web/lib/notify/*` (+ checks),
`apps/web/app/api/cron/cmo-digest/route.ts`, the settings block of `apps/web/lib/screens/load.ts`.

## Tasks

### - [ ] B1. Digest content (after A1)
- `buildDigest` returns: subject from the people ("3 people asked about late invoices"; none new → "2 posts wait
  for you"), a preview line (the strongest quote), and three blocks: **People asking** (open `reply` cards by score,
  at most 3: source, Strong/Good match, one pain or evidence quote, link to the card), **Follow up** (at most 2:
  replies whose `reply-outcomes` found an answer), **Posts** (one line: count waiting, next deadline).
- Remove "Went out", "Stuck", and the "Nothing goes out until you approve it" footer. Footer: "Replies are never
  posted for you." + schedule + change/stop link + support address.
- `empty` = no new person since the last sent digest, no follow-up, no post due today.
- Copy through `no-ai-slop` (no em dashes). Update `digest.check.ts` with the new shape and an autopilot case.
- Commit `Wave 2 B1: the morning email leads with people` and push.

### - [ ] B2. Schedule, skip and log (after A4)
- `digestDue`: local `digest_hour` on the days `digest_days` allows (weekdays Monday to Friday, daily, Monday, off).
- An empty digest writes a `skipped` row with a summary ("Nothing new: no person, follow-up or post due") instead of
  sending; a sent one writes `subject` and `summary` (`{ people, followUps, posts }`).
- Settings loader exposes `digestDays` and the log via `my_email_log`. Checks updated.
- Commit `Wave 2 B2: weekday schedule, skipped days in the log` and push. Tell C in its Requests.

### - [ ] B3. No expiring emails; a push before an autopilot post
- Stop `sendExpiringEmails` from the cron (delete the function and its check cases).
- For a founder with autopilot on: a web push 2 hours before an autopilot post goes out ("X post goes out at 14:00.
  Edit or skip it before then."), once per post, logged as `push`.
- Commit `Wave 2 B3: deadlines in the morning email and a push for autopilot` and push.

## Requests

(none yet)
