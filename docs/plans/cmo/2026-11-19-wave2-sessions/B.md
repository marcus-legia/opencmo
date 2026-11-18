# Session B — email and jobs

Plan: [`../2026-11-19-wave2-plan.md`](../2026-11-19-wave2-plan.md). Branch `claude/launch`. The target is the
canvas board "Proposed: morning email" (https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ); "Email today" shows what
to remove.

**Owns:** `apps/web/lib/cmo/digest.ts` (+ `digest.check.ts`), `apps/web/lib/notify/*` (+ checks),
`apps/web/app/api/cron/cmo-digest/route.ts`, the settings block of `apps/web/lib/screens/load.ts`.

## Tasks

### - [x] B1. Digest content (after A1)
- `buildDigest` returns: subject from the people ("3 people asked about late invoices"; none new → "2 posts wait
  for you"), a preview line (the strongest quote), and three blocks: **People asking** (open `reply` cards by score,
  at most 3: source, Strong/Good match, one pain or evidence quote, link to the card), **Follow up** (at most 2:
  replies whose `reply-outcomes` found an answer), **Posts** (one line: count waiting, next deadline).
- Remove "Went out", "Stuck", and the "Nothing goes out until you approve it" footer. Footer: "Replies are never
  posted for you." + schedule + change/stop link + support address.
- `empty` = no new person since the last sent digest, no follow-up, no post due today.
- Copy through `no-ai-slop` (no em dashes). Update `digest.check.ts` with the new shape and an autopilot case.
- Commit `Wave 2 B1: the morning email leads with people` and push.

### - [x] B2. Schedule, skip and log (after A4)
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

- **To C (B1 done):** `buildDigest` now returns `{ subject, preview, text, html, empty, summary }` and reads
  `people`, `followUps`, `posts` (`lib/cmo/digest.ts`). The footer links "Change when it comes" to
  `/app/settings#notifications`: give the Notifications section that anchor (C3). I changed one assertion in
  `lib/screens/acceptance.e2e.ts` (the digest's card link now comes from People asking or the Posts line).
- **To A (for B2):** `email_log_claim` needs at least one waiting card id; a day with only follow-ups cannot be claimed
  until A4 lets a digest (and a `skipped` row) be logged without card ids.
- **To B, from C (e2e):** `e2e/ui-v2-reach.spec.ts` "the morning digest lands in the mail catcher…" fails on the
  branch: `/api/cron/cmo-digest` answers `sent: 0` (line 117). The test seeds one waiting post card with no time and no
  person, which B1's `empty` rule now skips. Please update its seed with B2 (a person asking, or a post due today) and
  assert the `skipped` row for the empty case; C runs it again in C6.
- **To C (B2 done, for C3):** the settings screen now has `digestDays` (`weekdays | daily | monday | off`) and
  `emailLog: EmailLogEntry[]` (`lib/screens/settings.ts`: `id, kind, day, status: sent | skipped, subject | null,
  summary { people, followUps, posts, note? } | null, at`), live and in the fixture. A skipped morning's `summary.note`
  is "Nothing new: no person, follow-up or post due". Saving the days needs `app/api/v1/cmo/settings/route.ts` to pass
  `p_digest_days` (yours, per A's note). Off (`digest_days = 'off'`) sends nothing and logs nothing.
- **To C (your e2e request, done in B2):** `e2e/ui-v2-reach.spec.ts` now asserts the `skipped` row first, then marks
  the seeded post due today (`approvals.post_at = now()`); the cron answers `skipped` too. `lib/screens/p6-acceptance.e2e.ts`
  does the same and reads `sendDigestEmail`'s new outcome (`"sent" | "skipped" | "none"`). Not run here (no Docker).

