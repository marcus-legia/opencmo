# Approval: the founder's department

Status: **built** (`main` at `4f70a59`, 2026-11-08). Designed 2026-10-26, built in phases A0–A3 (P1–P6) and the CMO
review (#169–#180). Markdown twin of [`approval.html`](approval.html), written for agents; the two must say the same
thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md), [`studio.md`](studio.md).

Approval is where "assist, never act" is enforced. Every department raises a card; nothing goes out, and nothing paid
runs, until the founder approves exactly what the card shows. In the owner's sketch of 2026-11-08 there are two
approvals: the words (plan, posts, slide text, briefs) and then what was made from them (finished video, shorts,
slideshow), each followed by the schedule.

## 1. Verdict

**Built:** one `approvals` table and one `approval_decide` RPC under the inbox, the CMO chat and the reminders; the
snapshot rule (JCS content hash, price, time, account); 11 card kinds covering every department; reminders that open a
card but never decide it (digest, email, web push); a daily card budget; every decision teaching the brain.

**Not in the table:** the Assistant's priced cards in the editor chat (`awaiting_approval` in `lib/agent/loop.ts`) and
MCP's signed confirm codes stay their own surfaces, each with a price before anything is spent. Design decision 5
below (chat cards recorded in `approvals`) was not built.

**Left (plan 2026-11-08):** fewer cards a week (its own plan). Done: one card per job and no dead ends (S2.6: "Copy and open" and "I posted it" on a draft with no connected account, `cmo_post_myself`), and a price card before every Sales scan (S3.5–S3.6).

## 2. Approval as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Surface | Where | What it approves | State |
|---|---|---|---|
| Approval inbox | `app/app/inbox/`, `components/screens/` (v2 shell), `lib/cmo/pending.ts` | every card kind in §5, grouped by department; one card opens at `/app/inbox/[id]` | ✅ |
| One table, one decide | `approvals`, `approval_raise`, `approval_decide`, `approval_snapshot`, `app/api/v1/approvals/[id]/route.ts` | owner check under RLS, advisory lock, "already decided", the snapshot hash checked again, daily caps | ✅ |
| The old decision RPCs | `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`, `cmo_decide_correction`, `cmo_mark_posted` | called by `approval_decide`; `approvals_sync` triggers keep the rows in step | ✅ |
| CMO chat decisions | `lib/agent/cmo-decisions.ts` | the founder approves or schedules by asking; the chat shows the card and calls the same RPC on confirm; the model never passes a hash | ✅ |
| Assistant chat cards | `lib/agent/loop.ts` (`awaiting_approval`), `scope.ts` priced tools | generations, voice-over, background, edit video, explainer, `create_video`; price shown, nothing spent before approve | ✅ (not in `approvals`) |
| MCP confirm codes | `packages/mcp-server/src/confirm.ts` | the same priced tools; a signed code valid 600 s (`CONFIRM_SECONDS`) | ✅ (not in `approvals`) |
| Reminders | `lib/cmo/digest.ts`, `lib/notify/` (email through Resend, web push through VAPID), `email_log`, `push_subscriptions` | open the card, never decide it | ✅ (live with the owner's keys) |
| Card budget | `card_budget`, `card_budget_take`, `approval_release_held` | about ten new cards a founder's local day; past it a card is `held` until the next day; time-bound cards are never held | ✅ |
| Founder's Claude inbox | `cmo_inbox`, `inbox_submit` | not an approval: model calls waiting for the founder's Claude | ✅ |

## 3. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| Buffer approvals | drafts from "Needs approval" members wait in an Approvals tab; scheduling separate from approval | a dedicated Approvals view; drafts stay drafts until approved | scheduling apart from approval (for us the time is approved too) |
| Okara | "Needs your attention" feed next to the agent log | one feed of decisions, separate from the activity log | — |
| Higgsfield | `awaiting_approval` with plan and credit price before render | a price on every paid card, in the inbox too | — |
| Agent Opus (internal) | paid steps only through a button; auto-continue only on free steps; tools return an `approval_url` | auto-continue never on paid or outbound steps (E5.2); a link to the card instead of acting | — |
| 12-factor agents | contact humans with a tool call; pause, resume from a webhook | a card is a paused work order (`brain.md` §4b) | — |
| HITL pattern write-ups (2026) | approve a scoped plan with a real preview; calibrated autonomy; approval fatigue; approve and undo as primary buttons | preview exactly what will happen; few cards; batch low-risk only; auto-run only free, internal, reversible | approving raw commands |
| Vercel AI SDK | tool approval per input (`needsApproval`), approval request part | approval decided per input, not per tool name | switching our loop to it |

## 4. Design: one table, one decide RPC, three surfaces

Cards appear where the founder already is (inbox for the brain's work, chat for work started in the editor, confirm
code for MCP); the brain's cards are rows of one table decided by one RPC.

- **Raised by:** Brain (week plan, goal, corrections), Writer (posts, captions), Sales (reply drafts), Studio (prices,
  finished video, shorts batch, slides), Schedule (time + account per slot).
- **Seen in:** Approval inbox (web and phone, grouped by department); the CMO chat (the same card); Assistant chat
  card (when started in the editor); MCP confirm (signed code, 600 s); reminders (digest, email, web push; open the
  card, never decide).
- **Decided by:** `approval_decide` (wraps `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`,
  `cmo_decide_correction`): owner only under RLS, advisory lock, idempotent, checks the snapshot is current, daily
  outbound caps.
- **Outcomes:** approved → event rule → next order; edited then approved → similarity + edit mode →
  `cmo_draft_outcomes`; sent back → reason → the order replans once (repeated → correction); skipped → memory;
  expired → a new card.

The table as built:

```
id, user_id
kind            post | reply | goal | script | price | finished_video | shorts_batch
                | slideshow | schedule | correction | plan
department      brain | research | writer | studio | sales | schedule | publish
ref_kind, ref_id  content_item | opportunity | goal | correction | studio_step
                | editor_project | short_batch | schedule_slot | work_order
snapshot        jsonb (≤ 32 KB) + content_hash (JCS, SHA-256)
price_credits, post_at, account
status          waiting | held | approved | edited | skipped | expired | cancelled
decided_via     app | email | push | mcp
reason, expires_at, held_until, released_at, created_at, decided_at
```

As built, a superseded card is `cancelled`, a sent-back card is recorded with its reason on the row it refers to, and
batching is by row (one `short_batch` for the shorts of one video) rather than a `batch_id`.

## 5. Card kinds

| Kind | Raised by | Shows | Actions | State |
|---|---|---|---|---|
| `plan` | Brain | the week plan, item by item | approve, edit or remove items | ✅ (`20270106050000`) |
| `goal` | Brain | goal, metric, target | approve, change target, reject | ✅ |
| `post` | Writer | text per platform, 1–2 alternates, checks passed, and the time and account it goes out on | approve (the words and the time at once), edit then approve, change time, skip with reason | ✅ X, Threads, LinkedIn |
| `reply` | Sales | thread, score with evidence, reply draft | copy and open, replied, dismiss | ✅ |
| `script` | Studio Director | storyboard: words, picture, motion per beat | approve, send back | ✅ |
| `price` | Studio | what will be made, one price for all of it | approve, cancel | ✅ |
| `finished_video` | Studio | preview player, length, frame, look check note | approve = finished, open in editor, send back | ✅ |
| `shorts_batch` | Studio Shorts | 3 shorts with hook and reasons | approve the batch, send back | ✅ |
| `slideshow` | Studio Slideshow | slides, MP4 and PNG | approve, quick text edit per slide, open in Slides | ✅ |
| `schedule` | Schedule | platform, account, date and time, the deliverable; for a post, only when its approved time is gone, a retry or an older card | approve, change time (re-approve), cancel | ✅ |
| `correction` | Brain (repeated edits) | a rule learned from edits, with its source edits | approve, edit, reject | ✅ |
| `skill` | Brain | a proposed skill change | — | ❌ not built |

## 6. Rules

1. **You approve exactly what you saw.** The snapshot holds the content hash (JCS), price, time and account; any change
   after the card was raised supersedes it and raises a new one.
2. **Outbound and paid never auto-approve.** Only free, internal, reversible items may skip a card, and only on opt-in.
3. **Few cards.** Batch what belongs together (shorts of one video, slides of one slideshow, posts of one day); keep the
   daily count low.
   A post card carries its time (cmo-review-3 1.2): `body.proposed` (platform, time, account, mode) is in the snapshot,
   so approving the post approves its time and account too. `schedule_propose` then makes the slot `waiting` with that
   approval and raises no schedule card; a time that can no longer be used falls back to one schedule card that says
   so. Changing the time or account raises the post card again.
4. **Cards expire.** Schedule cards when their time passes; price cards when the price changes or after a set time
   (MCP: a confirm code lasts 600 s). Expired cards ask again; they never run late.
5. **Reminders never decide.** Email or push opens the card; no approve button in an email (mail scanners open links).
6. **Every decision teaches.** Approve-as-is, edits and their mode, send-back and skip reasons go to the brain's memory.
   A post's Skip offers reasons as chips, and an edited approve asks once, optional, "What did you fix?"
   (cmo-review-3 2.1): a chip that names an edit is the founder's label (`labelled_by = 'founder'`), never relabelled
   by the classifier, and two of a kind in 14 days propose a rule (the model's labels need three).

## 7. Reaching a founder who is not in the app

| Channel | How | Built in | Note |
|---|---|---|---|
| Badge and morning digest | `pending.ts` count; digest at the top of the inbox and the Dashboard | `lib/cmo/digest.ts`, Modal `cmo_digest` (hourly, each founder's morning) | ✅ |
| Email digest | daily when cards wait, plus one before time-bound cards expire | `lib/notify/email.ts` (Resend), `email_log`, an unsubscribe link | ✅ live with `RESEND_API_KEY` and `OPENCMO_EMAIL_LIVE=1` |
| Web push | VAPID keys, a service worker, allowed push hosts (`packages/contracts/push-hosts.json`) | `lib/notify/push.ts`, `push_subscriptions` | ✅ live with the VAPID keys; on iPhone only for a site added to the Home Screen (iOS 16.4+) |
| Phone-first inbox | cards, previews (signed URL of the preview file), decisions at phone width | the v2 shell | ✅ |

## 8. Learning from decisions

Every card kind records its outcome: X posts and the other platforms record the version chosen, approved-text
similarity and the edit mode (`cmo_draft_outcomes`, `classify-edits.ts`); skip reasons become memories; a Studio
send-back becomes a lesson (`approvals_studio_lesson`). Repeated edit modes are counted by a trigger
(`cmo_draft_outcomes_learn`) and return as a `correction` card (brain tier 0 memory).

## 9. Safety

| Risk | Guard |
|---|---|
| Approving one thing, running another | snapshot hash checked by `approval_decide` and again by the order before it runs |
| Double click, retries | advisory lock, "already decided", idempotent decide; spec hash for generations (built) |
| Someone else's card | owner check under RLS in the RPC |
| Injected text in a draft | the card shows the exact outbound text and destination; outside text stays data (`lib/cmo/untrusted.ts`) |
| Approval fatigue | batching, a daily card budget, low-risk items only on opt-in |
| Too many outbound actions | daily caps per platform in SQL, extended per platform |

## 10. Measures

Approved as is per kind and department · time from card to decision · cards per day per founder · expired and
superseded cards · send-back reasons (next eval cases).

## 11. Build phases

All built: **A0** `approvals` + `approval_decide` wrapping the old RPCs · **A1** the snapshot rule and Studio cards in
the inbox · **A2** digest, Resend email, web push, the phone-first inbox · **A3** `schedule` cards with expiry. The
CMO review added the `plan` card and the daily card budget.

Next, ranked by the CMO loop (owner, 2026-11-08; one card per job and no dead end are done in S2.6 and S3.5–S3.6): fewer
cards a week: today a week is about 15–20 cards ([`workflow.md`](workflow.md) §3); the owner's sketch has two
approvals, the words and then what was made. That gets its own plan.

## 12. Decisions for the owner

| # | Question | Decision (owner, 2026-10-26: as recommended) |
|---|---|---|
| 1 | Auto-approve for anything? | only free, internal, reversible items; never posts, replies, schedules or paid work |
| 2 | Approve from an email? | no; the email opens the card |
| 3 | A daily card budget? | yes, about 10 (built: `card_budget`); the brain holds the rest for the next day |
| 4 | Team members approving for the founder? | not now |
| 5 | Where do chat-started cards live? | in the chat; **not built**: they are not recorded in `approvals` (the Assistant's and MCP's priced cards stay their own surfaces) |

## Sources

Code: `apps/web/components/cmo/workspace/` (`FeedPanel.tsx`, `actions.ts`, `GoalCards.tsx`),
`apps/web/lib/cmo/pending.ts`, `load-workspace.ts`, `workspace.ts`, `apps/web/lib/agent/loop.ts`, `scope.ts`,
`packages/mcp-server/src/confirm.ts`, `supabase/schema/current.sql` (`cmo_decide_post`, `cmo_decide_opportunity`,
`cmo_decide_goal`, `cmo_mark_posted`, `operation_log`, `cmo_draft_outcomes`); internal studies of Agent Opus and
Higgsfield.

Outside:
- https://support.buffer.com/article/665-managing-and-approving-draft-posts
- https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents
- https://myengineeringpath.dev/genai-engineer/human-in-the-loop/
- https://www.dataiku.com/blog/human-in-the-loop-ai-agents
- https://pub.towardsai.net/designing-for-ai-agents-8-ux-patterns-that-build-trust-in-2026-713a0c926933
- https://github.com/humanlayer/12-factor-agents
- https://www.issoh.co.jp/tech/details/10402/ (AI SDK `needsApproval`)

The HITL write-ups are secondary sources; the iPhone web push limit (Home Screen web apps, iOS 16.4+) is Apple's
published behaviour, not re-checked here.
