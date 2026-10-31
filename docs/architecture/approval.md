# Approval: the founder's department

Status: **proposed** (2026-10-26), research before build. Markdown twin of [`approval.html`](approval.html), written
for agents; the two must say the same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md),
[`studio.md`](studio.md).

Approval is where "assist, never act" is enforced. Every department raises a card; nothing goes out, and nothing paid
runs, until the founder approves exactly what the card shows.

## 1. Verdict

**Built:** decisions in owner-checked RPCs with locks (`cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`,
`cmo_mark_posted`); outbound caps in SQL (5 X approvals a day, `operation_log`); every decision teaches the brain (skip
reasons → memories; edits measured in `cmo_draft_outcomes`); price before spending (Assistant priced cards, MCP signed
confirm codes).

**Missing:** three card systems that do not know each other (CMO inbox, Assistant chat cards, MCP confirm codes); no
snapshot (nothing proves the approved thing is what runs; time and account are in no approval); no card kinds for
Studio or Schedule; no way to reach a founder outside the app.

**Proposal:** one `approvals` table and one `approval_decide` RPC under all three surfaces; the snapshot rule; new
card kinds; reminders that open a card but never decide it.

## 2. Approval today (`main`, `eb858ca`)

| Surface | Where | What it approves | State |
|---|---|---|---|
| CMO inbox ("Awaiting your approval") | `components/cmo/workspace/FeedPanel.tsx`, `lib/cmo/pending.ts`, `actions.ts` | X posts (approve with edited text, skip with reason, mark posted), Reddit threads (replied, dismiss), weekly goals (approve, change target, reject) | built |
| Decision RPCs | `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`, `cmo_mark_posted` | owner check, advisory lock, "already decided", 280 characters, 5 X approvals a day, outcome rows | built |
| Assistant chat cards | `lib/agent/loop.ts` (`awaiting_approval`), `scope.ts` priced tools | generations, voice-over, 3D, background, edit video, explainer, `create_video`, `animate_video`; price shown, nothing spent before approve | built |
| MCP confirm codes | `packages/mcp-server/src/confirm.ts` | the same priced tools; a signed code valid one hour (`PREVIEW_SECONDS = 3600`) | built |
| Founder's Claude inbox | `cmo_inbox`, `inbox_submit` | not an approval: model calls waiting for the founder's Claude | built |
| One table, snapshot, Studio and Schedule cards, reminders | none | — | missing |

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
code for MCP); underneath they are the same row and the same RPC.

- **Raised by:** Brain (week plan, goal, corrections), Writer (posts, captions, scripts, articles), Sales (reply drafts),
  Studio (prices, finished video, shorts batch, slides), Schedule (time + account per slot).
- **Seen in:** Approval inbox (web and phone, grouped by department); Assistant chat card (when started in the editor);
  MCP confirm (signed code, one hour); reminders (digest, email, web push; open the card, never decide).
- **Decided by:** `approval_decide` (new; wraps `cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`): owner
  only under RLS, advisory lock, idempotent, checks the snapshot is current, daily outbound caps.
- **Outcomes:** approved → event rule → next order; edited then approved → similarity + edit mode → `cmo_draft_outcomes`;
  sent back → reason → the order replans once (repeated → correction); skipped → memory; expired → raise a new card.

```
id, user_id
kind            see section 5
subject         deliverable_id | work_order_id | goal_id | correction_id
source          work_order | assistant_turn | mcp
snapshot        { content_hash (JCS), price, publish_at, account_id, platform, preview_url }
status          pending | approved | edited | sent_back | skipped | expired | superseded
reason, edit_similarity, edit_mode
batch_id        shorts of one video share it
raised_at, expires_at, decided_at
```

Migration path: existing RPCs stay and `approval_decide` calls them (no visible change); Assistant chat cards write a
row when raised and decided (the chat stays the surface); MCP's confirm code becomes the row id plus its signature;
`pending.ts` counts `approvals` rows.

## 5. Card kinds

| Kind | Raised by | Shows | Actions | State |
|---|---|---|---|---|
| `post` | Writer | text per platform, 1–2 alternates, checks passed | approve, edit then approve, skip with reason, mark posted | built (X) |
| `reply` | Sales | thread, score with evidence, reply draft | copy and open, replied, dismiss | built |
| `goal` | Brain | goal, metric, target | approve, change target, reject | built |
| `price` | Studio | what will be made, credits, wait | approve, redo one keyframe, cancel | chat only |
| `script` | Writer / Studio Director | storyboard: words, picture, motion per beat | approve, edit a beat, send back | inside card 1 today |
| `finished_video` | Studio | preview player, length, frame | approve = finished, open in editor, send back | new |
| `shorts_batch` | Studio Shorts | 3 shorts with hook and reasons | approve the batch (decided), send back | new |
| `slideshow` | Studio Slideshow | slides, MP4 and PNG | approve, quick text edit per slide, open in Slides | new |
| `schedule` | Schedule | platform, account, date and time, the deliverable | approve, change time (re-approve), cancel | new |
| `correction`, `skill` | Brain (Sunday summary) | a rule learned from edits, with its source edits | approve, edit, reject | new |

## 6. Rules

1. **You approve exactly what you saw.** The snapshot holds the content hash (JCS), price, time and account; any change
   after the card was raised supersedes it and raises a new one.
2. **Outbound and paid never auto-approve.** Only free, internal, reversible items may skip a card, and only on opt-in.
3. **Few cards.** Batch what belongs together (shorts of one video, slides of one slideshow, posts of one day); keep the
   daily count low.
4. **Cards expire.** Schedule cards when their time passes; price cards when the price changes or after a set time
   (MCP: one hour). Expired cards ask again; they never run late.
5. **Reminders never decide.** Email or push opens the card; no approve button in an email (mail scanners open links).
6. **Every decision teaches.** Approve-as-is, edits and their mode, send-back and skip reasons go to the brain's memory.

## 7. Reaching a founder who is not in the app

| Channel | How | Build or buy | Note |
|---|---|---|---|
| Badge and morning digest | `pending.ts` count; digest card at the top of the inbox | build | first |
| Email digest | daily when cards wait, plus one before time-bound cards expire | buy: Resend | links open the card |
| Web push | VAPID keys, a service worker | build | on iPhone only for a site added to the Home Screen (iOS 16.4+); email stays the reliable channel |
| Phone-first inbox | cards, previews (signed URL of the preview file), decisions at phone width | build | the editor sends phones to a computer; Approval must not |

## 8. Learning from decisions

Today X posts record the version chosen, approved-text similarity and the edit mode (`cmo_draft_outcomes`,
`classify-edits.ts`); skip reasons become memories. The same must hold for every card kind. The Sunday summary turns
repeated signals into a proposed correction that returns as a `correction` card (brain tier 0 memory).

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

- **A0** `approvals` + `approval_decide` wrapping today's RPCs; posts, Reddit, goals move onto it with no visible change;
  `pending.ts` reads it; pgTAP per transition.
- **A1** Snapshot rule + Studio cards (`price`, `finished_video`, `shorts_batch`, `slideshow`) in the inbox, sharing the
  Assistant's card components; needed by Studio S1–S3 and brain B3.
- **A2** Reaching the founder: morning digest, Resend email, web push, phone-first inbox.
- **A3** `schedule` cards with expiry; opt-in for free internal items to skip cards; outbound never.

## 12. Decisions for the owner

| # | Question | Decision (owner, 2026-10-26: as recommended) |
|---|---|---|
| 1 | Auto-approve for anything? | only free, internal, reversible items; never posts, replies, schedules or paid work |
| 2 | Approve from an email? | no; the email opens the card |
| 3 | A daily card budget? | yes, about 10; the brain batches or waits beyond it |
| 4 | Team members approving for the founder? | not now |
| 5 | Where do chat-started cards live? | in the chat, recorded in `approvals`; the inbox shows only work the founder did not start by hand |

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
