# The CMO brain

Status: **built** (`main` at `4f70a59`, 2026-11-08). Designed 2026-10-25, built in phases B0–B4 (P1–P6) and the CMO
review (#169–#180). Markdown twin of [`brain.html`](brain.html), written for agents; the two must say the same thing.
Parent page: [`ai-cmo.md`](ai-cmo.md).

The design: a small LLM planner on top of deterministic code that owns dispatch, budgets and approval.

## 1. Verdict

**Kept from before**
- One loop, many configurations: the CMO chat runs on the Assistant loop with its own scope (`lib/agent/scope.ts`).
- One place that asks a model (`jobs/think.ts`), with two brains: our models, or the founder's own Claude through the
  inbox. No competitor we read has the second.
- Steps logged before and after each call, leases, `Deferred`, credit hold per run, daily limits in SQL.
- Three memory tiers with a Sunday summary (what Letta calls sleep-time compute).
- Learning from the founder's edits (`cmo_draft_outcomes`, `classify-edits.ts`).

**Added, and built**
- A **work order tree** with briefs, dependencies and budgets (`work_orders`).
- A **progress ledger**: a daily, code-only check of the tree; a replan only when work is stuck (`jobs/progress.ts`).
- A **capability registry** so the brain reaches Studio, Schedule and Publish through the same tools as buttons and
  MCP (`packages/contracts/capabilities.json`).
- **Event rules** (SQL triggers), a **weekly budget** that is a hard gate with a cost ceiling, a **kill switch**, and a
  **corrections log** read first (`cmo_corrections`).

Not adopted, and still not: a multi-agent framework (CrewAI, LangGraph, AutoGen) or a hosted workflow engine (Inngest,
Temporal, Vercel Workflow). The reliable part is code-owned control flow; the Postgres queue and Modal clock give
durability; CLAUDE.md forbids a second runtime.

## 2. The brain as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Part | Where | What it does | State |
|---|---|---|---|
| Agents | `lib/cmo/agents/registry.ts` | 20 agents in two tiers, all on Claude: Sonnet for drafting and planning, Haiku for checks, translation and picks. The only per-agent setting is `CMO_AGENT_<ID>_MODEL` (and its own `CMO_AGENT_<ID>_API_KEY`) | ✅ |
| Two brains | `lib/cmo/brain.ts`, `jobs/think.ts` | `opencmo` (our keys, credits) or `claude` (founder's Claude over MCP; model calls become inbox requests and replay with the answer) | ✅ |
| CMO chat | `lib/agent/scope.ts` (`cmoScope`), `cmo-tools.ts` | Assistant loop, 11 CMO tools (`read_doc`, `list_calendar`, `list_approvals`, `create_task`, `remember`, `read_skill`, `read_site`, `get_run_result`, `set_week_goal`, `update_document`, `open_screen`) + the research tools | ✅ · 🟡 `create_task{agent:"sales"}` starts a paid scan with no card (plan S3.5) |
| Job queue | `cmo_runs`, `jobs/runner.ts` | 12 job kinds (`lib/cmo/jobs/types.ts`) plus `onboard`; steps logged, lease, defer, credit hold, daily limit | ✅ |
| Loops | `lib/cmo/loops.ts` | 7 loops with cadence and condition; the daily cron enqueues what is due | ✅ |
| Work orders | `work_orders`, `work_order_events` | the week's tree beside `cmo_runs`: one root a week, an order per plan item, children per department; a run's order follows it (`work_orders_follow_run`) | ✅ |
| Memory | `marketing_documents`, `cmo_memories`, `cmo_lessons`, `cmo_corrections` | profile; events by topic, importance, expiry; weekly lessons; corrections | ✅ |
| Goals | `cmo_goals`, `review_week` | one weekly goal the founder approves; measured and re-proposed on Sunday | ✅ |
| Reach into Studio | `lib/cmo/jobs/studio-orders.ts`, `lib/departments/studio/adapter.ts` | Studio orders (`build_video`, `cut_shorts`, `build_slideshow`, `build_post_image`) run through the Studio adapter under the founder's short-lived JWT | ✅ (`build_post_image` has no caller yet) |
| Progress check | `jobs/progress.ts`, `progress-run.ts` | daily, code only: done, stuck, over budget, waiting on the founder; a stuck order gets one replan | ✅ |
| Budgets and gates | `20270107010000_cmo_review_budget_gate.sql`, `lib/cmo/pause.ts` | weekly budget as a hard gate, cost ceiling, kill switch (§9) | ✅ |
| Morning digest | `lib/cmo/digest.ts`, Modal `cmo_digest` | a template, no model call; in the app and by email | ✅ |

## 3. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| Okara AI CMO | competitor, launched 2026-03-16 at $99/month; one orchestration layer over 6–10 sub-agents; 120,000+ businesses on Vercel | URL → shared context every agent reads; every draft held for approval; a morning inbox of a few concrete actions | agents as the product; Reddit replies reported as flagged AI |
| Higgsfield Supercomputer (internal study 2026-10-19) | one chat agent, ~250 tools, `ai_cmo_*` tools, subagents with toolsets, AI Employees | subagent = goal + role + toolset per task; plan and credit price before render; `awaiting_approval` / `awaiting_user_answer`; recurring tasks | 250 tools in one context; recreate-an-ad and face features |
| Agent Opus planner (internal study 2026-10-19) | one planner LLM, 7 tools, one-action JSON, runtime owns phase changes | runtime owns paid transitions; structured `last_failure` the next step must fix; atomic todos the planner closes | AGPL code; the long-take pipeline (Studio's concern) |
| ai-cmo-operator (MIT) | open-source "AI VP of Marketing": orchestrator routes, specialists act; Claude Agent SDK, Supabase, Resend | orchestrator only routes; every skill ends with an artifact; load 2–5 context files per job; append-only corrections log; code gates for invented numbers, voice, stage fit; cost ceiling auto-pause; 30-second kill switch | editor-only operator; markdown files as the database |
| OpenCMO on GitHub (study8677) | open-source BYOK "AI CMO" with our name, OpenAI Agents SDK, approval queue, SQLite | little technically; the **name collision** needs a trademark and search check before launch | its auto-publish switch |
| Anthropic, multi-agent research | lead agent + 3–5 parallel subagents | brief = objective, output format, tools and sources, boundaries; effort scaled in the prompt; plan saved outside the context; resume from the failing step; start evals with ~20 real cases, judge outcomes not paths | parallel subagents by default (~15× the tokens of a chat; fits breadth-first research only) |
| 12-factor agents (HumanLayer) | principles for production agents | own the control flow; contact humans through a tool call that pauses and resumes; small focused agents; state in your database | — |
| Magentic-One (Microsoft) | orchestrator with two ledgers | task ledger (facts, guesses, plan) + progress ledger (done? looping? progressing? next step); replan only when progress stalls | free-form "next speaker" selection |
| Letta / Hermes Agent / Anthropic context engineering | agent memory designs | always-visible core blocks + searchable archive; sleep-time memory work; just-in-time retrieval; skills that improve after use | self-editing skills without review |
| Inngest, Vercel Workflow, Temporal | durable execution engines | memoized steps, durable sleep, wait-for-event, copied onto `cmo_runs.steps`, `Deferred` and the inbox | the engines (a second runtime) |

## 4. Design

Only the **Planner** and the **Reviewer** call a model. Everything else is code.

| Component | Does | Calls a model | Built in |
|---|---|---|---|
| Triggers | clock (Modal daily 00:05 UTC, hourly digest, every minute) · founder (chat, buttons, approvals) · founder's Claude (MCP) · events (a deliverable's status changed) | — | `modal_app.py`, SQL triggers |
| Planner | `plan_week`, replan, chat orders; writes the plan and a tree of work order briefs | yes | `jobs/plan-week.ts`, `work_orders_plan_week` |
| Reviewer | `review_week`, `summarize_memory`; measures the goal, writes lessons, proposes the next goal | yes | `jobs/review-week.ts`, `summarize-memory.ts` |
| Task ledger | goal (`cmo_goals`), plan (calendar), facts (documents, last week's results, open questions) | no | `cmo_goals`, `content_items` |
| Progress ledger | daily, code only: done? stuck? over budget? waiting on the founder? stuck → one replan, not a loop | no | `jobs/progress.ts` |
| Dispatcher | brief → `work_order`: department, kind, `depends_on`, budget, capabilities from the registry | no | `work_order_create` |
| Event rules | finished → shorts; approved → Schedule; due → Publish; posted + 24 h → measure | no | SQL triggers (§4b) |
| Gatekeeper | weekly budget, cost ceiling, kill switch, paid or outbound → approval; RPC gates underneath (`cmo_enqueue`, `credit_hold`); the brain never posts | no | §9 |
| Memory | what the brain learns: archive by topic, lessons, corrections log; reads the Library (section 8b) for documents, brand, voice and skills | — | §8 |
| Think router | `think()`: `opencmo` → registry models; `claude` → founder's inbox | — | `jobs/think.ts` |

Output: work orders to Research, Writer, Sales, Studio, Schedule, Publish and Approval (the founder). Deliverables
with a status feed event rules; metrics, edits and outcomes feed memory and next week's plan.

## 4b. How the brain runs without a browser

No machine stays on for the brain. **Supabase** holds every order and its state, **Modal** is the clock and the
muscle, **Vercel** is where the brain thinks, and the **browser** is only the screen where the founder reads and
approves. Closing the browser stops nothing the brain does.

```
00:05 UTC daily   Modal cmo_schedule ──GET──▶ Vercel /api/cron/cmo        loops due today → rows in the queue
every hour        Modal cmo_digest   ──GET──▶ Vercel /api/cron/cmo-digest  the morning digest in each founder's timezone
every minute      Modal sweep()      ──POST─▶ Vercel /api/internal/cmo/run  once per waiting order (≤ 10)
                                               answers 202, works in after(): claim with a lease, run steps,
                                               think(), write results; longer work defers
                                               itself (cmo_defer_run) and resumes on a later sweep
                  sweep() also: reclaims expired leases, closes stuck Assistant turns and open credit jobs
heavy work        Vercel ──submit──▶ Modal worker; worker claims rows in `tasks` with a lease
browser           reads cards and approves under RLS; when closed, cards wait in `waiting_founder`
founder's Claude  (claude brain mode) requests wait in `cmo_inbox` until it answers
```

| Wire | What travels on it | Built in |
|---|---|---|
| 1 Rows in Postgres | the main wire: the brain inserts an order row with a brief; a department claims it with a lease, writes its result, changes the status; no agent calls another directly | `cmo_runs`, `work_orders`, `tasks`, `deliverables` |
| 2 HTTP with a secret | Modal → Vercel (`CRON_SECRET`) wakes the brain; Vercel → Modal `submit` (worker token) starts heavy work at once; MCP → worker `wake` (a token that can do nothing else) | `opencmo/worker/cmo_dispatch.py` |
| 3 Event rules | a trigger on status changes inserts the next order: edit finished → `cut_shorts`; short or post approved → Schedule; slot due → Publish; posted + 24 h → measure | `editor_projects_rules`, `tasks_studio_rules`, `approvals_caption_rules`, `schedule_follow_deliverable`, `work_orders_follow_approval` |

**Long work: the brain never waits on a machine.**
- A video order hands its brief to the Studio team and moves to `waiting_order`, holding no lease and no machine.
- When the team's generations are done, the next `sweep` wakes the order (`studio_steps_ready`).
- A card waits in `waiting_founder` as long as it takes; email and web push remind the founder.
- A crash mid-step loses nothing: the lease expires, the order returns to the queue, logged steps replay.

**The one part that needs a browser: the Assistant chat.** When a turn hits its time or step limit, the open tab calls
`continue` (`awaiting_continue` in `lib/agent/loop.ts`), and tools such as frame capture run in the tab. That is why
the brain never drives the editor through a hidden chat: it calls the Studio team's entry points with `plan` /
`decide`, which MCP also runs with no browser.

**The step cut at 280 s (#178).** The routes run on Vercel Hobby, where a request cannot pass 300 s: past it the
platform kills the request with no answer, and the turn failed minutes later as "stopped responding" (2026-11-08, an
explainer's scene code written in one step). A model step still streaming 280 s after its request started is cut
(`STEP_DEADLINE_MS` in `lib/agent/limits.ts`), so the loop can still record the call and tell the model to go smaller;
after `MAX_LATE_STEPS` (2) late steps in one turn it stops and says so. Whether to move to Vercel Pro is the owner's
decision.

Compared with an agent kept alive in a cloud container per session, state lives in Postgres and compute wakes only
when a row is waiting: idle costs nothing, a crash resumes from the last logged step, and there is no second runtime.

## 5. The weekly cycle (Modal clock, UTC)

| When | What runs | Model | Credits | Built in |
|---|---|---|---|---|
| Sunday | `summarize_memory`, `review_week`, `competitor_research` when handles exist | yes | free, free, 2 | `loops.ts` |
| Monday | `plan_week` → the plan card + the work order tree (one order per calendar item, children per department: brief → Studio order → shorts → captions); `niche_video_research` once a week when the plan has a new video item, and the briefs wait on it | once | as priced; research 2 | `work_orders_plan_week`, `20261231110000_p5_niche_research.sql` |
| Every day | progress check over the tree; only a stuck order costs a model call (one replan) | rarely | free | `jobs/progress.ts` |
| Every day, when due | `post_draft`, `sales_scan`, `pull_metrics` (loops); `write_caption`, `write_video_brief`, `write_slides` and Studio orders (from the work order tree and event rules) | yes | per kind | `loops.ts`, `work_orders`, `studio-orders.ts` |
| Any time | event rules; founder orders from chat or MCP land under the week's root | no | free | SQL triggers |
| Every morning, founder's time | digest: what waits on you, what the brain did, today's plan | no (template) | free | `lib/cmo/digest.ts` |

## 6. Work orders

`work_orders` sits **beside** `cmo_runs` instead of replacing it (decision 3 below changed in the build): a run is
still the job a department executes, and its order follows it. Schema as built:

```
id, user_id, root_id, parent_id, week (a Monday)
department      brain | research | writer | studio | sales | schedule | publish
kind            plan_week, post_draft, write_video_brief, build_video, cut_shorts,
                build_slideshow, build_post_image, write_caption, publish_post…
title, brief    { objective, output, sources, boundaries, done_when } (≤ 4 KB)
status          queued | running | waiting_founder | waiting_order | deferred
                | done | failed | cancelled
depends_on      uuid[]   (≤ 20, all must be done)
budget_credits, spent_credits
run_id → cmo_runs, item_id → content_items
created_by      loop | chat | event | mcp | founder
due_at, finished_at, done_reason
error           { code, message, … }
```

Rules (built):
- **One writer of status**: an RPC per transition (`work_order_move`, `work_order_wait_founder`, `studio_order_move`);
  every change is logged in `work_order_events`.
- **Ends with an artifact**: `done` needs a deliverable or a stated `done_reason`.
- **Children inherit the root's budget** and cannot spend more than the parent has left (`work_order_spend`).
- **Paid or outbound children wait** (`waiting_founder`) with the price shown.
- **A failure is data**: the replan reads `error.code` and may not retry the same brief unchanged
  (`work_order_mark_replanned`).
- **Effort scales by kind**: the registry sets steps and credits per kind.

States: `queued → running`; `running` pauses into `waiting_founder`, `waiting_order` or `deferred` (no lease held)
and resumes when approved, answered or the timer fires; it ends `done`, `failed` or `cancelled` (rejected, over
budget, kill switch). `failed` goes to the Planner for one replan with a new brief.

## 7. Capability registry

`packages/contracts/capabilities.json` with `capabilities.schema.json`, checked by `lib/cmo/capabilities.check.ts`:
every CMO job is listed once, a job's fixed price is the one SQL charges (`cmo_job_price`), the Studio adapter's
entries have the callers `STUDIO_ACCESS` gives them, and every file that starts a CMO job or calls the Studio adapter
must be listed as a caller. A new path (a private brain shortcut, a new route) fails the check until the registry says
who it is.

- `effect`: read | write | spend | outbound; `approval`: none | founder | price.
- `callers` keeps the brain from a private path.
- Tools stay where they are (`editor-core` ops, `cmo-tools.ts`, the Studio adapter); the registry only lists them.

## 7b. Brain ↔ Studio: the brain briefs the Video agent team

Two levels of orchestration, as in Agent Opus: the brain plans the week and hands a brief to Studio; Studio's own
agent team plans and makes the deliverable. The brain never drives single tools inside the team. Editing the
founder's own video stays hands-on.

**The Studio adapter** (`lib/departments/studio/adapter.ts`) has eight entry points: `plan`, `decide`, `buildVideo`,
`cutShorts`, `markFinished`, `renderShort`, `buildSlideshow`, `buildPostImage` (`STUDIO_ENTRIES` in `types.ts`).
Callers: the brain's order runner, the Assistant chat, MCP. `buildVideo` and `renderShort` are the brain's; marking an
edit finished is the founder's call only.

| Squad | Members (kind) | State |
|---|---|---|
| Long take `/video` | Director (LLM, agent `director`: script, beats, keyframe + motion) → Reviewer (code, `review()` in `create-video.ts`, sends back once) → one storyboard card with one price → one job hold (`credit_orders`) → keyframes, text check, shots, voice and music in one go (`startAfter` / `endAfter`) → Builder (code: `create_video` op, one editable scene) | ✅ built; hidden in the web app (`CREATE_VIDEO_HIDDEN` in `lib/agent/hidden.ts`, S2.4); MCP keeps `create_video` |
| Intro `/intro` (`plan_video`, `lib/agent/video-team.ts`) | Writer (LLM, agent `writer`) → Motion director (LLM, agent `motion`) → Reviewer (code, `reviewIntro()`) → Builder (code, `add_intro` op) | ✅ |
| Explainer `/explain` | `plan_explainer` (storyboard, direction, one price) → `preview_explainer` (stills and a layout report the model fixes) → `add_explainer` (one video layer from the approved job); re-planned in every turn (#180) | ✅ (`studio.md` §5b) |
| Shorts `cut_shorts` (only from a finished edit) | Segmenter (code) → Clip editor (LLM, agent `shorts`: picks candidates by id, writes hook, title and reason) → Clip reviewer (code, sends back once) → Builder (`make_short` op) → Renderer (`render_document` per short) → look check | ✅ |
| Slideshow `build_slideshow` | Slides writer (`write_slides`) → Builder (slide ops) → MP4 + PNG set (`render_document`, `render_stills`) → look check | ✅ |
| Post image `build_post_image` | a frame of the founder's video or a captured page with a title layer → one still | 🟡 built, no caller yet |
| Shared | Creem screens prompts before credits; Haiku vision + fal NSFW review images and 3 video frames after · Captions (translate) · credit holds, no double payment by spec hash · Version history checkpoint on every write | ✅ |

**What the brain adds**
- The brain is the team's third caller. It sends a brief from the week plan; the adapter runs the squad and raises the
  same cards in the Approval inbox.
- The work order waits in `waiting_founder` on a card and in `waiting_order` while generations run.
- In `claude` brain mode the founder's Claude may write the Director's plan (as MCP allows); the code Reviewer checks it.

**Rejected:** the brain calling `create_video` itself (it skips the team; every pipeline change would break the brain)
and a hidden Assistant chat (open loop, unpredictable cost, unseen cards). The team owns how a video is made; the
brain owns what the week needs.

**A brain video, in order** (Brain · Studio agent team · Worker + fal · You). Since S2.5 the week plan orders none;
the order kind stays for MCP and Studio:

1. Video brief (`write_video_brief`) → `build_video` order → the order holds its team allowance (`studio_order_hold`).
2. Director writes the plan; the Reviewer checks it; one price for the whole video: keyframes, shots, voice-over,
   music (nothing spent on media yet).
3. **Card 1**: storyboard and that one price. 4. You approve: one job hold for the estimate (`credit_orders`).
5. Every piece starts at once from the hold; each shot waits on the worker for its keyframes; the Builder places one
   scene.
6. Generations done → the order resumes → render → look check.
7. **Card 2**: the finished video, to open in the editor and tweak. Approving marks the edit finished.
8. Event rule → `cut_shorts` → **Card 3**: the shorts batch; approved shorts go to Schedule with their captions.

**History:** the contact sheet card (once card 2) was removed on 2026-11-06 (charge before running, D9); one keyframe is changed
after with `redo_keyframe`, at its own price. Its last leftovers (the redo branch, `ContactSheet.tsx`) were removed in S2.8 (`814dbb7`).

- **Security:** the team runs under the founder's RLS session; a Studio order mints a short-lived user JWT as MCP
  does (`brainClientFor`); the service role never writes an editor document.
- **Money:** the team's model calls are paid from the order's allowance (§9); keyframes, shots, voice and music from
  the job hold confirmed on card 1; the Shorts squad spends no generation credits; all count against the order tree's
  budget (`studio_video_budget()` = 60 for a video order).

## 8. Memory

| Tier | Holds | Loaded | Comparable to | Built in |
|---|---|---|---|---|
| 0 Corrections | short rules from the founder's repeated edits, each with its source edits; a repeated-edit trigger proposes one, the founder approves the card | always, first | ai-cmo-operator corrections log | `cmo_corrections`, `cmo_draft_outcomes_learn` |
| 1 Profile | four `marketing_documents` (read from the Library, section 8b) + weekly goal | always | Letta core blocks | ✅ |
| 2 Events | `cmo_memories` by topic, importance, expiry | the job's topic + `general` | Letta archival memory | ✅ |
| 3 Lessons | `cmo_lessons`, one per topic per week | before events | Letta sleep-time agents | ✅ |

- Loading rule: a brief names the documents and topics it needs; the job loads only those.
- Corrections come from `classify-edits.ts` edit modes counted by a trigger, not from the Sunday summary as first
  designed.
- Not now: vector search, until a founder passes about 200 memory rows.

## 8b. The Library: shared knowledge the brain reads but does not own

Owner decision, 2026-10-27. What belongs to the business lives in one **Library** that the brain and every department
read (`components/screens/library/`). The brain keeps only what it produces itself. Reasons: departments also run
without the brain (the editor, the founder's own Claude through MCP), each thing has one copy the founder edits in one
place, and briefs stay small because a brief names what to load.

| In the Library | In code | Drafted by | Edited by | Read by |
|---|---|---|---|---|
| Business: the four marketing documents | `marketing_documents`, `lib/cmo/documents.ts` | Research at onboarding | founder | every department; the brain as memory tier 1 |
| Brand Kit: colours, fonts, captions, frame, logo | `brand_kits`, `lib/brand.ts`, `editor-core/src/brand.ts` | founder | founder | Studio, the editor, Slideshow |
| Voice: notes learned from edits, words the founder cuts | `strategy.voice` and `avoid` in the documents; learned notes through `voice_notes_for` | the brain, from edits | founder deletes or edits | Writer, Sales |
| Writing skills: no-ai-slop, platform profiles, the founder's own | `lib/cmo/skills/no-ai-slop.md`, `packages/contracts/platforms.json`; founder skills via `editor_skills` | built in, or saved by the founder | founder turns them on or off | Writer, Sales |
| Video skills: style skills, the founder's own | `packages/skills`, `editor_skills` | built in, or saved from the Assistant | founder | Studio, the editor |

| In the brain | Why it stays there |
|---|---|
| Goal, week plan, work orders, budgets | the brain's own decisions |
| Events, lessons, corrections (memory tiers 0, 2, 3) | learned by the Reviewer; corrections need the founder's approval card |

Not in the Library: the department playbooks in `lib/cmo/skills/` (`x-writing.md`, `reddit-listening.md`,
`short-video.md`, the `marketingskills/` set…). They are how each department does its job, shipped and versioned by
us, so they stay with the department; the Library shows only what the founder can change. (The set lived in
`lib/cmo/skills/library/` until 2026-10-27 and was renamed to avoid the clash; its MCP resource URIs keep
`opencmo://skills/library/` so connected clients do not break.)

Rules:
- The brain never copies Library content into its own tables; a brief names Library items and the job loads them.
- A voice note learned from edits is written to the Library, not to brain memory, so Writer uses it even when the brain
  is off; newer notes win when two disagree.

## 9. Budgets and gates

| Gate | Where | Rule | Learned from | State |
|---|---|---|---|---|
| Ownership, credit hold, daily limit | RPC (`cmo_enqueue`, `credit_hold`) | every order passes them | our web rules | ✅ |
| Weekly budget | `cmo_runs_budget_gate` (`20270107010000`) | a hard limit for runs the brain starts itself (schedule, event, replan): one that would take the week past its budget is refused with a reason. Work the founder asks for, and Studio steps behind a card the founder approved, are not gated | Higgsfield spend approval | ✅ |
| Cost ceiling | the same migration | the brain's own runs holding more than 40 % of the weekly budget (at least 10 credits) within an hour pause the brain (`cmo_paused_at`) with a note | ai-cmo-operator | ✅ |
| Kill switch | `OPENCMO_CMO_PAUSED=1` (global, `lib/cmo/pause.ts`) + each founder's Pause CMO (`profiles.cmo_paused_at`) | stops every order within one sweep | ai-cmo-operator | ✅ |
| Studio order hold | `studio_order_hold` (`20270109050000`) | a Studio order holds an allowance (`studio_plan_hold()` = 5 credits) before its team calls a model; short of it the order fails as `needs_credits` and no model runs; what is unused comes back when the order ends | review C1 (team calls were free at 0 credits) | ✅ |
| Invented numbers, words to avoid, no links, hashtags per platform | code before the checker model | `check-post.ts` per platform profile; no-ai-slop stays guidance, not code (`writer.md`) | ai-cmo-operator, our cascade judge | ✅ |
| Stage fit | planner prompt | no tactics that do not fit the founder's stage (no testimonials the documents do not hold) | ai-cmo-operator | ✅ prompt only |
| Outbound | Approval + Publish | the brain never posts; time and account are approved | product rules | rule |
| Untrusted text | `lib/cmo/untrusted.ts` | outside text is data, never instructions | our security reports | ✅ |

## 9b. What an Assistant turn costs

The CMO chat and the Editor Assistant run on the same loop (`lib/agent/loop.ts`), and a turn holds credits before it
calls a model.

- **Overage is billed** (`20270109010000_agent_turn_overage.sql`). A turn is billed for every credit it used. Until
  then the close charged `least(hold, used)`, so a step that ran past the hold was free.
- **The explainer cap** (`20270110010000_review_fixes.sql`). The `plan_explainer` card promises "writing and
  checking, up to `agent_3d_hold_credits()`" (20 credits). A turn that opened an explainer job is charged at most
  that for its tokens; past it, the cost is ours.
- **Stuck turns close.** The sweep closes turns left running or waiting (`agent_reap_turns`) and, with them, credit
  jobs left open for a day (`credit_orders_reap`).

## 10. Evals

| Measure | From | Target to start |
|---|---|---|
| Plan accepted without edits | plan cards approved as is | half of plans |
| Drafts approved as is | `cmo_draft_outcomes` similarity ≥ 0.95 | up week over week |
| Orders done on time | `work_orders` done before `due_at` | most |
| Credits per approved deliverable | spent / approved | down week over week |
| Replans per week | progress check | few |
| Plan eval | real profiles in `lib/cmo/jobs/eval`: goal fit, mix, stage fit, feasibility | pass on the cascade judge |

## 11. Build phases

All built: **B0** corrections and budget fields · **B1** `work_orders` beside `cmo_runs` · **B2** progress check,
kill switch, morning digest · **B3** capability registry, event rules, the shared Studio adapter · **B4** brain evals.
The weekly budget became a hard gate in the CMO review (B3.1–B3.2, `20270107010000`).

Done in the CMO review 2 plan: the first week within minutes of paying (S2.2) and a week plan without AI video (S2.5).
What is left for the brain, ranked by the CMO loop: a price card before every Sales scan (S3.5), and fewer cards a
week (its own plan).

## 12. Decisions for the owner

| # | Question | Decision |
|---|---|---|
| 1 | May the brain create free orders on its own? | yes; paid or outbound orders always wait |
| 2 | Default weekly budget | built as a hard gate; the default is set from measured credits per approved deliverable |
| 3 | Extend `cmo_runs` or add `work_orders` next to it? | **built next to it**: `work_orders` follows `cmo_runs`, so the run's lease rules, limits and status queries did not move |
| 4 | May the brain propose skill and correction changes? | yes, as approval cards, never silently |
| 5 | Morning digest by email? | yes, through Resend (live with the owner's key) |
| 6 | The open-source "OpenCMO" repo | check trademark and search results before launch spend |

## Sources

Code: `apps/web/lib/cmo/` (`brain.ts`, `loops.ts`, `jobs/runner.ts`, `jobs/think.ts`, `agents/registry.ts`,
`jobs/classify-edits.ts`), `apps/web/lib/agent/cmo-tools.ts`, `scope.ts`, `supabase/schema/current.sql`. Internal
research: `opencmo-internal/docs/cmo/tham-khao.md`, `docs/specs/2026-10-19-hoc-higgsfield.md`,
`2026-10-19-hoc-agent-opus-2-prompt-tool-agent.md`.

Outside:
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://anthropic.com/engineering/effective-context-engineering-for-ai-agents
- https://github.com/humanlayer/12-factor-agents
- https://arxiv.org/pdf/2411.04468 (Magentic-One)
- https://github.com/guerrilla2799/ai-cmo-operator (MIT)
- https://github.com/study8677/OpenCMO
- https://github.com/NousResearch/hermes-agent (MIT)
- https://www.letta.com/blog/agent-memory
- https://www.idlen.io/news/okara-ai-cmo-autonomous-marketing-agent
- https://vercel.com/blog/how-okara-runs-cmo-agents-for-120000-companies-on-vercel (summary only)
- https://www.alexcloudstar.com/blog/temporal-vs-inngest-vs-vercel-workflow-2026

Okara's agent count and scale come from secondary write-ups and Vercel's case study summary; the Anthropic figures
(15× tokens, 90.2%, ~20 starting cases) were read on Anthropic's page.
