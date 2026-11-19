# Session B — jobs and prompts

Plan: [`../2026-11-20-wave3-plan.md`](../2026-11-20-wave3-plan.md). Branch `claude/launch`. Every prompt that writes
for a reader embeds `NO_AI_SLOP` and is listed in `lib/cmo/skills/no-ai-slop.check.ts`; each job change gets an eval
case with the fake provider (`npm run cmo:eval -- --provider fake`).

**Owns:** `apps/web/lib/cmo/jobs/sales-scan.ts`, `sales-reply-drafts.ts`, `plan-week.ts`, `draft-post.ts`,
`reply-outcomes.ts`, `lib/cmo/onboard.ts`, `lib/cmo/loops.ts`, `lib/cmo/schedule.ts`, `lib/cmo/today.ts`
(+ checks), prompts under `lib/cmo/skills/` used by these jobs, `jobs/eval/cases/*`.

## Tasks

### - [ ] B1. The scan fills the Library and the reach check (after A2, A3)
In the scoring step, also return per thread: a one-line summary of the post (never its title), the theme it belongs
to (reuse an existing theme name when it fits, else a new short name), and the reach check from the post and thread
only (buyer in their own words, wants now, warm, fresh, a way to reach them: DMs allowed by the platform and the
community's rules; an email only when it is in the post or thread, or on the business site the post links).
Save via `cmo_save_library` and `cmo_save_reach`. No profile reads. Eval: summary is not the title; a vendor author is
not a buyer; HN is never DM ready.

### - [ ] B2. DM drafts and nudges (after B1)
For DM-ready people, draft one DM (short, refers to the public reply, says the product is theirs, asks before linking).
For replied people with no answer after 4 days, draft one nudge. Saved by A3's RPCs; founder sends. Eval cases.

### - [ ] B3. Posts from the Library (after A2, A4)
`plan_week` picks topics from the top Library themes of the last 14 days (and the Post plan's channels and rhythm);
each planned post carries `PostSource[]`. `post_draft` writes from those sources and stores them on the content
item. No Library entries: no automatic post (the week plan says so in one line). A chat brief still drafts.
Eval: every draft cites at least one source; no invented numbers.

### - [ ] B4. Onboarding writes documents v2; voice in prompts (after A4)
Onboarding fills `strategy.where_they_ask` and `this_week`, `brand.look` (colours, font, logo from the site),
`post_plan` (channels default X, LinkedIn, Threads). Reply, DM, nudge and post prompts read `brand.voice_samples`,
`intro_line` and `avoid`. Update the document eval.

### - [ ] B5. Scan cadence and Today (after A5)
`loops.ts`: a `sales_scan` loop on `sales_settings.cadence` for paid accounts, independent of the week plan (drop the
`dueSales` condition). `today.ts`: a `hot_lead` reason (Strong match or thread under 24 h) and a `follow_up` reason
above posts; the "nothing posted for N days" reason drops below them. Checks updated.

### - [ ] B6. Follow-up re-reads (after A3)
`reply-outcomes` uses `reply_url` when present, sets `person_status = answered_back` when someone answered the
founder, and adds Threads and Facebook groups where the social reader returns comments; where it cannot, it leaves
the status to the founder. Check updated.

## Requests

(none yet)
