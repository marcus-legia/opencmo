# The CMO brain

Status: **proposed** (2026-10-25), research before build; nothing here is built yet. Markdown twin of
[`brain.html`](brain.html), written for agents; the two must say the same thing. Parent page:
[`ai-cmo.md`](ai-cmo.md).

The design: a small LLM planner on top of deterministic code that owns dispatch, budgets and approval.

## 1. Verdict

**Keep**
- One loop, many configurations: the CMO chat runs on the Assistant loop with its own scope (`lib/agent/scope.ts`).
- One place that asks a model (`jobs/think.ts`), with two brains: our models, or the founder's own Claude through the
  inbox. No competitor we read has the second.
- Steps logged before and after each call, leases, `Deferred`, credit hold per run, daily limits in SQL.
- Three memory tiers with a Sunday summary (what Letta calls sleep-time compute).
- Learning from the founder's edits (`cmo_draft_outcomes`, `classify-edits.ts`).

**Add**
- A **work order tree** with briefs, dependencies and budgets.
- A **progress ledger**: a daily, code-only check of the tree; a replan only when work is stuck.
- A **capability registry** so the brain reaches Studio, Schedule and Publish through the same tools as buttons and MCP.
- **Event rules**, a **weekly budget** with a cost ceiling and a kill switch, and a **corrections log** read first.

Do not adopt a multi-agent framework (CrewAI, LangGraph, AutoGen) or a hosted workflow engine (Inngest, Temporal,
Vercel Workflow): every source agrees the reliable part is code-owned control flow; the Postgres queue and Modal
clock already give durability; CLAUDE.md forbids a second runtime.

## 2. The brain today (`main`, `eb858ca`)

| Part | Where | What it does | State |
|---|---|---|---|
| Agents | `lib/cmo/agents/registry.ts` | 12 agents, draft and check tiers, provider per agent by env, failover | built |
| Two brains | `lib/cmo/brain.ts`, `jobs/think.ts` | `opencmo` (our keys, credits) or `claude` (founder's Claude over MCP; model calls become inbox requests and replay with the answer) | built |
| CMO chat | `lib/agent/scope.ts`, `cmo-tools.ts` | Assistant loop, 10 CMO tools (`read_doc`, `list_calendar`, `list_approvals`, `create_task`, `remember`, `read_skill`, `read_site`, `get_run_result`, `set_week_goal`, `update_document`) + 9 research tools | built |
| Job queue | `cmo_runs`, `jobs/runner.ts` | 8 kinds (`onboard`, `plan_week`, `post_draft`, `sales_scan`, `competitor_research`, `pull_metrics`, `summarize_memory`, `review_week`); steps logged, lease, defer, credit hold, daily limit | built |
| Loops | `lib/cmo/loops.ts` | 7 loops with cadence and condition; the daily cron enqueues what is due | built |
| Memory | `marketing_documents`, `cmo_memories`, `cmo_lessons` | profile; events by topic, importance, expiry; weekly lessons | built |
| Goals | `cmo_goals`, `review_week` | one weekly goal the founder approves; measured and re-proposed on Sunday | built |
| Plan → work | `content_items` | the week plan is calendar rows; a due row triggers a draft loop; no tree, no dependencies, no budget per order | partial |
| Reach into Studio | none | no CMO tool touches the editor; video briefs removed with clipping (2026-10-20) | missing |
| Progress check | none | nothing notices a plan that stalls mid-week | missing |

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

| Component | Does | Calls a model | State |
|---|---|---|---|
| Triggers | clock (Modal daily 00:05 UTC, every minute) · founder (chat, buttons, approvals) · founder's Claude (MCP) · events (a deliverable's status changed) | — | events new |
| Planner | `plan_week`, replan, chat orders; writes the task ledger and a tree of work order briefs | yes | partial |
| Reviewer | `review_week`, `summarize_memory`; measures the goal, writes lessons, proposes the next goal | yes | built |
| Task ledger | goal (`cmo_goals`), plan (calendar), facts (documents, last week's results, open questions) | no | built |
| Progress ledger | daily, code only: done? stuck? over budget? waiting on the founder? stuck → one replan, not a loop | no | new |
| Dispatcher | brief → `work_order`: department, kind, `depends_on`, budget, capabilities from the registry | no | new |
| Event rules | approved → Schedule order; due → Publish order; posted + 24 h → measure | no | new |
| Gatekeeper | weekly budget, cost ceiling, kill switch, paid or outbound → approval; RPC gates underneath (`cmo_enqueue`, `credit_hold`); the brain never posts | no | new on top of built RPCs |
| Memory | what the brain learns: archive by topic, lessons, corrections log (new); reads the Library (section 8b) for documents, brand, voice and skills | — | mostly built |
| Think router | `think()`: `opencmo` → registry models; `claude` → founder's inbox | — | built |

Output: work orders to Research, Writer, Sales (built), Studio, Schedule, Publish (new), Approval (the founder).
Deliverables with a status feed event rules; metrics, edits and outcomes feed memory and next week's plan.

## 4b. How the brain runs without a browser

No machine stays on for the brain. **Supabase** holds every order and its state, **Modal** is the clock and the
muscle, **Vercel** is where the brain thinks, and the **browser** is only the screen where the founder reads and
approves. Closing the browser stops nothing the brain does. Most of this already runs today.

```
00:05 UTC daily   Modal cmo_schedule ──GET──▶ Vercel /api/cron/cmo        loops due today → rows in the queue
every minute      Modal sweep()      ──POST─▶ Vercel /api/internal/cmo/run  once per waiting order (≤ 10)
                                               answers 202, works in after(): claim with a lease, run steps,
                                               think(), write results; ≤ 300 s per call, longer work defers
                                               itself (cmo_defer_run) and resumes on a later sweep
heavy work        Vercel ──submit──▶ Modal worker; worker claims rows in `tasks` with a lease
browser           reads cards and approves under RLS; when closed, cards wait in `waiting_founder`
founder's Claude  (claude brain mode) requests wait in `cmo_inbox` until it answers
```

| Wire | What travels on it | State |
|---|---|---|
| 1 Rows in Postgres | the main wire: the brain inserts an order row with a brief; a department claims it with a lease, writes its result, changes the status; no agent calls another directly (`cmo_runs` → `work_orders`, `tasks`, `content_items` → `deliverables`) | built |
| 2 HTTP with a secret | Modal → Vercel (`CRON_SECRET`) wakes the brain; Vercel → Modal `submit` (worker token) starts heavy work at once; MCP → worker `wake` (a token that can do nothing else) | built |
| 3 Event rules | a trigger on status changes inserts the next order: video approved → `cut_clips`; clip approved → Schedule; posted + 24 h → measure | new |

**Long work: the brain never waits on a machine.**
- A video order hands its brief to the Studio team and moves to `waiting_order`, holding no lease and no machine.
- When the team's generations are done, the next `sweep` wakes the order (new: one more check in `sweep`).
- A card waits in `waiting_founder` as long as it takes; new: email and web push reminders.
- A crash mid-step loses nothing: the lease expires, the order returns to the queue, logged steps replay.

**The one part that needs a browser: the Assistant chat.** When a turn hits its time or step limit, the open tab calls
`continue` (`awaiting_continue` in `lib/agent/loop.ts`), and tools such as frame capture run in the tab. That is why
the brain never drives the editor through a hidden chat: it calls the Studio team's entry points with `plan` /
`decide`, which MCP already runs with no browser.

Compared with an agent kept alive in a cloud container per session, state lives in Postgres and compute wakes only
when a row is waiting: idle costs nothing, a crash resumes from the last logged step, and there is no second runtime.

## 5. The weekly cycle (Modal clock, UTC)

| When | What runs | Model | Credits | State |
|---|---|---|---|---|
| Sunday | `summarize_memory`, `review_week`, `competitor_research` when handles exist | yes | free, free, 2 | built |
| Monday | `plan_week` → task ledger + work order tree (one order per calendar item, children per department: script → video → clips → captions) | once | as today | tree is new |
| Every day 00:05 | progress check over the tree; only a stuck order costs a model call (one replan) | rarely | free | new |
| Every day, when due | `post_draft`, `sales_scan`, `pull_metrics`; later script, caption and Studio orders | yes | per kind | partial |
| Any time | event rules; founder orders from chat or MCP land under the week's root | no | free | new |
| Every morning | digest in the inbox (email later): what waits on you, what the brain did, today's plan | no (template) | free | new |

## 6. Work orders

`work_orders` grows out of `cmo_runs`; existing kinds keep working.

```
id, user_id, root_id, parent_id
department      research | writer | sales | studio | schedule | publish | brain
kind            plan_week, post_draft, write_script, build_video, cut_clips,
                schedule_slot, publish_post, check_progress…
status          queued | running | waiting_founder | waiting_order | deferred
                | done | failed | cancelled
brief           { objective, output, sources, boundaries, done_when }
depends_on      uuid[]   (all must be done)
budget_credits, spent_credits
deliverable_id  → deliverables
brain           opencmo | claude
created_by      loop | chat | event | mcp | founder
steps, attempt, lease_until, due_at
error           { code, message, retryable, repair_hint }
```

Rules:
- **One writer of status**: an RPC per transition; a job cannot mark itself done without a deliverable.
- **Ends with an artifact**: `done` needs a `deliverable_id` or a stated "nothing to do" reason.
- **Children inherit the root's budget** and cannot spend more than the parent has left.
- **Paid or outbound children wait** (`waiting_founder`) with the price shown.
- **A failure is data**: the replan reads `error.code` and `repair_hint` and may not retry the same brief unchanged.
- **Effort scales by kind**: the registry sets steps and credits per kind.

States: `queued → running`; `running` pauses into `waiting_founder`, `waiting_order` or `deferred` (no lease held)
and resumes when approved, answered or the timer fires; it ends `done` (deliverable written), `failed` or
`cancelled` (rejected, over budget, kill switch). `failed` goes to the Planner for one replan with a new brief.

## 7. Capability registry

One JSON file in `packages/contracts`, checked by `check:contracts` like `task-kinds.json`.

```json
{
  "name": "build_video",
  "department": "studio",
  "effect": "spend",
  "approval": "price",
  "callers": ["brain", "ui", "assistant", "mcp"],
  "order_kind": "build_video",
  "max_steps": 40,
  "credits": "quote",
  "input": "BuildVideoInput"
}
```

- `effect`: read | write | spend | outbound; `approval`: none | founder | price.
- `effect` + `approval` come from Claude Code's tool flags and the Vercel AI SDK's per-input approval (internal notes).
- `callers` keeps the brain from a private path.
- `max_steps` and `credits` are the effort budget, enforced by code.
- Tools stay where they are (`editor-core` ops, `cmo-tools.ts`); the registry only lists them.

## 7b. Brain ↔ Studio: the brain briefs the Video agent team

Two levels of orchestration, as in Agent Opus: the brain plans the week and hands a **video brief** to Studio; Studio's
own agent team plans and makes the video. The brain never drives single tools inside the team. It talks to Studio for
two jobs: an AI long video, then short clips cut from it. Editing the founder's own video stays hands-on.

**Studio agent team.** Lead = the pipeline runtime: it owns the phases and the approval cards. Entry points:
`create_video`, `animate_video`, `redo_keyframe`, `plan_video`, `cut_clips` (new); each priced one is
plan (price, nothing spent) → card → decide. Callers: the brain (new), the Assistant chat, MCP (founder's Claude,
brings its own plan).

| Squad | Members (kind) | State |
|---|---|---|
| Long take `/video` (PR #111 on `main`, learned from Agent Opus) | Director (LLM, agent `director`: script, beats, keyframe + motion) → Reviewer (code, `review()` in `create-video.ts`, sends back once) → Keyframes (model: `composeKeyframePrompt` + nano-banana / seedream) → Text checker (model: vision call per keyframe, badge, never fails) → Shot maker (model: `composeShotPrompt`, Veo 3.1 → Kling → Seedance) → Voice + music (model: premade voices with word timings, music bed) → Builder (code: `create_video` op, one sequence, editable scene) | built; real-model baseline (Tasks 0–1), acceptance video (Task 8) and release still open |
| Intro `/intro` (`plan_video`, `lib/agent/video-team.ts`) | Writer (LLM, agent `writer`) → Motion director (LLM, agent `motion`) → Reviewer (code, `reviewIntro()`) → Builder (code, `add_intro` op) | built |
| Clips `cut_clips` (only from a finished edit) | Clip editor (LLM: picks 2–5 ranges from beats and word timings) → Clip reviewer (code: whole sentences, hook first, length per platform) → Builder (code: `make_clip` op copies the timeline, sets workarea, frame 9:16) → Renderer (`render_document` per clip timeline) | new |
| Shared | Moderation (prompt before credits; image and 3 video frames after) · Captions (translate) · credit holds, no double payment by spec hash · Version history checkpoint on every write | built |

Team members are registry agents (`director`, `writer`, `motion`, `captions`, `moderation`), so each switches provider
by env. MCP (`packages/mcp-server/src/groups/studio.ts`) already runs the entry points without a chat.

**What the brain adds**
- The brain is the team's third caller. It sends a video brief from the week plan; the team's lead runs the squad and
  raises the same cards.
- Cards land in the **Approval inbox**; the work order waits in `waiting_founder` on a card and in `waiting_order`
  while generations run.
- In `claude` brain mode the founder's Claude may write the Director's plan (as MCP allows); the code Reviewer checks it.
- New squad: Clips, run only on an edit the founder marked finished.

**Rejected:** the brain calling `create_video` / `animate_video` itself (it skips the team; every pipeline change would
break the brain) and a hidden Assistant chat (open loop, unpredictable cost, unseen cards). The team owns how a video
is made; the brain owns what video the week needs.

Sequence (Brain · Studio agent team · Worker + fal · You):

1. Video brief → Director writes the plan.
2. Reviewer checks it; price of keyframes (nothing spent).
3. **Card 1**: storyboard + keyframe price. 4. You approve.
5. Team runs stage 1. 6. Keyframes + Text checker (worker). 7. Generations done → order resumes.
8. **Card 2**: contact sheet + exact video price. 9. You approve (or redo one keyframe).
10. Shot maker, Voice + music, Builder → one scene → render.
11. **Card 3**: finished video, open in the editor to tweak. 12. You approve = this edit is finished.
13. *New*: `cut_clips` → Clip editor picks, Clip reviewer checks, Builder. 14. *New*: Renderer, one export per clip.
15. *New*: **Card 4**: clips; approved ones go to Schedule.

| Piece | How | State |
|---|---|---|
| Video brief | `build_video` work order; maps onto `create_video` input (prompt, seconds, aspect, voice) + Brand Kit + strategy voice | new |
| Cards 1 and 2 | the team's storyboard card and contact sheet in the Approval inbox; redo one keyframe as today | cards built; inbox placement new |
| Card 3 finished | approving the rendered video marks the edit finished | new |
| Clips squad | as above | new |
| Export of a named timeline | export draws the active timeline over its workarea; exporting a clip timeline without switching the founder's view needs a check | to check |
| Card 4 clips | each approved clip is a deliverable (`kind = clip`, `parent_id` = the video); event rules hand it to Schedule | new |

- **One adapter for the team:** move what MCP's studio group does (clip scope, plan, sign, decide) into
  `lib/departments/studio`; MCP and the brain both call it.
- **Security:** the team runs under the founder's RLS session; a Studio order mints a short-lived user JWT as MCP does;
  the service role never writes an editor document.
- **Money:** Director call = agent credits (none in `claude` mode); keyframes, shots, voice, music = media credits as
  today; the Clips squad spends no generation credits; all count against the order tree's budget.
- Phase B3; lines up with the long-take plan's Task 8 and editor roadmap E4.1 and E4.5.

## 8. Memory

| Tier | Holds | Loaded | Comparable to | State |
|---|---|---|---|---|
| 0 Corrections | short rules from the founder's edits and skip reasons, append-only, each with its source | always, first | ai-cmo-operator corrections log | new |
| 1 Profile | four `marketing_documents` (read from the Library, section 8b) + weekly goal | always | Letta core blocks | built |
| 2 Events | `cmo_memories` by topic, importance, expiry | the job's topic + `general` | Letta archival memory | built |
| 3 Lessons | `cmo_lessons`, one per topic per week | before events | Letta sleep-time agents | built |

- Loading rule: a brief names the documents and topics it needs; the job loads only those.
- Corrections come from `classify-edits.ts` labels; the Sunday summary proposes a correction, the founder approves the card.
- Not now: vector search, until a founder passes about 200 memory rows.

## 8b. The Library: shared knowledge the brain reads but does not own

Owner decision, 2026-10-27. What belongs to the business lives in one **Library** that the brain and every department
read. The brain keeps only what it produces itself. Reasons: departments also run without the brain (the editor, the
founder's own Claude through MCP), each thing has one copy the founder edits in one place, and briefs stay small
because a brief names what to load.

| In the Library | Today in code | Drafted by | Edited by | Read by |
|---|---|---|---|---|
| Business: the four marketing documents | `marketing_documents`, `lib/cmo/documents.ts` | Research at onboarding | founder | every department; the brain as memory tier 1 |
| Brand Kit: colours, fonts, captions, frame, logo | `brand_kits`, `lib/brand.ts`, `editor-core/src/brand.ts` | founder | founder | Studio, the editor, Slideshow |
| Voice: notes learned from edits, words the founder cuts | voice in `marketing_documents` (`strategy.voice`, `avoid`); learned notes new | the brain, from edits | founder deletes or edits | Writer, Sales |
| Writing skills: No AI Slop guidance, platform profiles, the founder's own | platform rules inside `lib/cmo/skills/x-writing.md`; No AI Slop and profiles new; founder skills via `editor_skills` | built in, or saved by the founder | founder turns them on or off | Writer, Sales |
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
- The brain never copies Library content into its own tables; a brief names Library items and the job loads them
  (section 8, loading rule).
- A voice note learned from edits is written to the Library, not to brain memory, so Writer uses it even when the brain
  is off; newer notes win when two disagree.
- UI: one Library page with four tabs (Business, Brand Kit, Voice, Skills). Research keeps insights; Writer shows the
  voice it uses and links to the Library.

## 9. Budgets and gates

| Gate | Where | Rule | Learned from | State |
|---|---|---|---|---|
| Ownership, credit hold, daily limit | RPC (`cmo_enqueue`, `credit_hold`) | every order passes them | our web rules | built |
| Weekly budget | `work_orders` root | credits per week set by the founder | Higgsfield spend approval | new |
| Cost ceiling | progress check | spend faster than planned pauses the tree | ai-cmo-operator | new |
| Kill switch | flag per founder + global env | stops every order within one sweep | ai-cmo-operator | new |
| Invented numbers, words to avoid, no links, no hashtags in posts | code before the checker model | `check-post.ts`, extended per platform; No AI Slop stays guidance, not code (`writer.md`) | ai-cmo-operator, our cascade judge | partial |
| Stage fit | planner prompt + code check | no tactics that do not fit the founder's stage | ai-cmo-operator | new |
| Outbound | Approval + Publish | the brain never posts; time and account are approved | product rules | rule |
| Untrusted text | `lib/cmo/untrusted.ts` | outside text is data, never instructions | our security reports | built |

## 10. Evals

| Measure | From | Target to start |
|---|---|---|
| Plan accepted without edits | plan cards approved as is | half of plans |
| Drafts approved as is | `cmo_draft_outcomes` similarity ≥ 0.95 | up week over week |
| Orders done on time | `work_orders` done before `due_at` | most |
| Credits per approved deliverable | spent / approved | down week over week |
| Replans per week | progress check | few |
| Plan eval | ~20 real profiles in `lib/cmo/jobs/eval`: goal fit, mix, stage fit, feasibility | pass on the cascade judge |

## 11. Build phases

- **B0** Corrections + budget fields (no order tables yet).
- **B1** `work_orders` from `cmo_runs` (one migration, every existing kind keeps running; `plan_week` writes a tree; pgTAP per transition RPC).
- **B2** Progress check + kill switch + morning digest (code only, daily cron).
- **B3** Capability registry, event rules, shared Studio adapter: `build_video` and `cut_clips` (section 7b), every paid step behind a card.
- **B4** Brain evals (20 real profiles, plan judge, measures on the dashboard).

Each phase gets its own plan in `docs/plans/` before code. B0–B2 do not touch the editor; B3 is where the brain meets Studio.

## 12. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | May the brain create free orders on its own? | yes; paid or outbound orders always wait |
| 2 | Default weekly budget | set after B1 from measured credits per approved deliverable |
| 3 | Extend `cmo_runs` or add `work_orders` next to it? | extend and rename in one migration; two queues would split every lease rule, limit and status query |
| 4 | May the brain propose skill and correction changes? | yes, as approval cards, never silently |
| 5 | Morning digest by email? | yes once Resend is wired; in-app first |
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
