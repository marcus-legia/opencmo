# The feed after an approval: Approve first, the week on the feed, live (2026-11-11)

Branch `claude/approve-flow-dashboard-jv2rjx`. One PR.

## 1. What the owner said (2026-11-11)

- "I still do not see where to approve."
- "I read a post and approve it: where does it show?"
- "Why does the dashboard show nothing?"
- Check the flows end to end, with what each feature changes around it: CRUD and realtime. Testing the product showed
  only errors. Learn the dashboard from the Okara study.

## 2. What a walk through the app found

The stack was run locally (Supabase, the web app, the fake providers of the e2e suite) and walked as a new founder:
Setup → feed → open the post → Approve → look for it.

| # | Found | Cause |
|---|---|---|
| 1 | Approve is hard to find on a post | With no connected account the card led with "Open X" and "I posted it"; "Approve for this time" was a quiet text link after four buttons. |
| 2 | An approved post vanishes from the feed | The feed listed waiting cards only. The post was on Calendar and in Writer, and the feed said nothing. |
| 3 | "0 scheduled" right after an approval | The feed read the week once and never again; only the queue reloaded after a decision. |
| 4 | One approval counted "2 done" | A time approved with its post is a `schedule` card that is born decided; Today counted it as the founder's. |
| 5 | The feed is blank once the queue is empty | No week, no activity: only the agents' tiles were left. |
| 6 | "Planned", "Scheduled", "Posted" showed an empty list | "Planned" listed calendar slots (one), not the week's seven items; an empty step drew nothing at all. |
| 7 | A draft asked from the chat threw the founder to Writer | The chat opened Writer when its run finished, off the page the card arrives on. |
| 8 | Locally nothing happens after the first card | Only Modal fires due slots, runs queued CMO work and calls the daily schedule. `npm run dev` did none of it, so queued runs stayed queued and tomorrow's post was never written. |

## 3. Decisions

- **Approve leads.** On a post with no connected account the order is Approve for this time, Open X, I posted it,
  Edit, Change time, Skip. Posting by hand right now stays one click away. Labels are unchanged.
- **The feed keeps a row for every piece of the week**, under the list that needs the founder: Planned, Being
  written, Waiting on you (Review opens its card in the list above), Approved (with the time it goes out and a link
  to Calendar), Posted. Read from the Writer screen, so the feed and Writer say the same thing. An approved post's
  time is its slot's.
- **Activity on the feed**: the last six lines of the log (what the founder decided, what the agents did), with "All
  activity" opening Logs. This is the Okara lesson already in `approval.md` §3 (a list of decisions next to the
  agents' log), now on the page where the decisions are made.
- **Whatever moves the queue re-reads the week**: a decision, a new card, a log line, Refresh, and a change to a
  slot (`schedule_slots` over Realtime). One read for a burst.
- **The steps are filters with an answer**: Planned lists the week, Scheduled and Posted list slots with their
  time, and an empty step says what fills it.
- **On the feed the chat does not move the founder**: a finished draft's card arrives in the list. The run line's
  Open still goes to Writer.
- **`npm run dev` sweeps every minute** like Modal: `schedule_claim_due`, `/api/internal/cmo/run`, and
  `/api/cron/cmo` at start and hourly. `OPENCMO_DEV_SWEEP=0` turns it off.

## 4. Todo

- [x] `ApprovalCard`: Approve first on a post the founder posts themselves.
- [x] `Feed`: "This week" and "Activity"; steps with empty states; Review from the week opens the card.
- [x] `Feed`: the week and the slots re-read after every change of the queue; `schedule_slots` live.
- [x] Writer screen: an approved post carries its slot's time.
- [x] Today: a card born decided is not counted as done.
- [x] Chat: stays on the feed when a draft is ready; e2e `ui-v2-live` follows.
- [x] `scripts/dev.mjs`: the local sweep.
- [x] Walked again after the change: a draft asked in the chat arrives on the feed without a reload, Approve turns
  its row "Approved · Goes out Fri 13 Nov, 09:00", scheduled goes 1 → 2, Today 2 of 4 → 3 of 4, Activity shows it.

## 5. Not done here

- **The errors the owner saw with real providers.** With the fake providers no page and no request failed (16 pages
  walked). The real ones need the owner's keys: the worker log and the browser console of a failing run are the next
  thing to read.
- **The Okara dashboard itself.** The study lives in `opencmo-internal`, which this session could not open. The
  changes follow its summary in `2026-11-09-cmo-review-3-plan.md` and `approval.md`; a pass against the study's
  own dashboard notes is still owed.
- **The first session ends early.** After the week is approved there is one post to decide and then nothing until
  tomorrow's is written overnight. Drafting two or three posts in the free first run (or "Write tomorrow's now")
  would give a new founder more to approve before they leave; it costs model calls, so it is the owner's call.
- **Calendar shows approved slots only.** Planned items are in Writer and now on the feed, not on the Calendar.
