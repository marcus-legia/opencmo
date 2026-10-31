# P4: Schedule and Publish, every platform through Zernio

> **For agentic workers:** §2 says *what* ships, §5 the tasks. Three sessions build it on branch **`cmo-p4`** (PR into
> `cmo-build`). Each session's numbered todo list, owned paths and order are in
> [`2026-10-28-p4-sessions/`](2026-10-28-p4-sessions/): read `README.md` there, then your own file. Build nothing
> before your Task 0 is done; nobody builds on a contract before it is pushed.

## 0. Scope

Phase 4 of [`2026-10-28-backend-roadmap.md`](2026-10-28-backend-roadmap.md) (on branch `cmo-p2`). It builds three
backend phases: **P0** (Zernio checks and account connect) and **P1** (scheduled posting through Zernio) from
[`schedule-publish.md`](../../architecture/schedule-publish.md) §10, and **A3** (schedule cards with expiry) from
[`approval.md`](../../architecture/approval.md) §11. After it: 15 of 28 backend phases (≈ 54%).

**Status: draft, written early (owner, 2026-10-28).** It was written while P2 was being built. Before sessions start,
the planner merges `cmo-build` (with P2 and P3) into `cmo-p4` and refreshes §3. **The owner's Zernio checks (§6) come
first; nothing in Zernio's real API is called before they are done.** Until then every session builds and tests
against a fake Zernio adapter.

Not in this phase: best time from the founder's own data, jitter tuning, gaps and caps beyond the defaults (P2 best
time, P6), Zernio metrics (P3, P6), email or push reminders (A2, P6).

## 1. Goal and decisions

**Goal:** every approved post and short gets a proposed time, platform and account on a schedule card; once the
founder approves all three, it goes out at that time on the founder's own connected account through Zernio, and a
signed webhook confirms it. The Schedule page and Settings → Accounts read real rows.

**Decisions already made (owner, 2026-10-26, `schedule-publish.md` §11):**
- **Zernio for every platform, X included.** Tokens stay with Zernio; we store only Zernio profile and account ids.
- Posting at the approved time is allowed, per slot, with its own approval of content, time and account. Landing and
  cards say "you approve when it posts", not "you post it".
- The intent link (X intent, Threads web intent, LinkedIn/Facebook copy + open) stays only as a fallback for a founder
  with no connected account, or when Zernio is down.
- Minimum gap 3 hours per platform; X keeps 5 a day; others from data later.
- The AI-generated label is the founder's toggle on the card, off by default.
- Jitter up to ±4 minutes.
- Never late, never twice: a slot past its window becomes `missed` and raises a new card.

## 2. What ships

| # | Feature | The founder sees | Done when |
|---|---|---|---|
| F1 | Connect accounts | Settings → Accounts: "Connect X / TikTok / Instagram / YouTube / LinkedIn / Threads", the handle and avatar once connected, Disconnect | a Zernio profile per founder; connect link → Zernio OAuth → callback stores `social_accounts` (platform, handle, avatar, Zernio ids); disconnect removes them at Zernio and here |
| F2 | Timezone in Schedule | times in their own timezone | `profiles.timezone` (exists since wave 1 B0) read everywhere a time is shown or picked; onboarding sets it from the browser |
| F3 | Schedule slots | each approved item gets a proposed time | `schedule_slots` (`schedule-publish.md` §5); an approved `post`/`short` deliverable → a proposed slot from default slots per platform (data), gap and daily cap in SQL; a short and its long video never on the same platform the same day |
| F4 | Schedule cards | a card: content preview, platform, account, time, the platform's fields (TikTok: privacy, comment/duet/stitch, AI-generated label) | `approvals.kind` `schedule` with a snapshot of content + time + account + platform fields; approve, change time (supersedes, raises a new card), change account, cancel; expires at the slot time |
| F5 | Firing on time | it posts at the time they approved | Modal `sweep` (every minute) claims due slots with a lease through an RPC → `publish_post` work order → the CMO runner calls the publish adapter; an idempotency key per slot; past the window → `missed` + a new card |
| F6 | Media to Zernio | — | a new worker task `publish_media` streams the file from Storage to Zernio's presigned upload (never through Next.js), with the user-media rules |
| F7 | Webhook confirms | the item shows Published with a link, or Failed with the reason and Retry | signed Vercel route `/api/webhooks/zernio` with a receipts table against replays; sets slot and deliverable status; a failure raises a card whose Retry reuses the still-valid approval |
| F8 | Schedule page live | calendar with times; drag to move (supersedes the card); filters per platform | `schedule.slots`, `schedule.accounts`, `schedule.rules`, `schedule.timezone` live; `settings.accounts` live |
| F9 | Fallback | "No account connected: copy and open" | intent links stay for a founder with no connected account for that platform |
| F10 | Kill switch | Pause stops waiting slots too | the brain's pause (`brain_pause`) keeps every `waiting` slot from firing; resuming re-proposes past ones as new cards |
| F11 | Acceptance | — | a local run with the fake Zernio: connect (fake) → approve a post → schedule card → approve → sweep fires → webhook → Published; a missed slot; a failed post → Retry; a short with media |

## 3. What exists (`cmo-build` at `992d632`, P2–P3 planned; refresh before start)

- `profiles.timezone` (text, default `UTC`, validated against `pg_timezone_names` in `save_cmo_settings`),
  `weekly_credit_budget`, `digest_hour` (wave 1 B0).
- `approvals.kind` already allows `schedule`; `ref_kind` does not have a slot yet.
- `content_items` has `day` (date) only, `published_at`, `external_url`; `cmo_mark_posted`; `operation_log` caps
  (5 X approvals a day in `cmo_decide_post`).
- X intent: `xIntent()` in `components/cmo/workspace/actions.ts`; after P3, Threads and LinkedIn copy + open.
- Modal `sweep()` every minute reclaims leases and dispatches queued CMO runs to the web app (`_dispatch_cmo`); Modal
  is the only scheduler (`apps/web/vercel.json` has no crons).
- Task kinds in `packages/contracts/task-kinds.json` (one row, a migration on `tasks_kind_check`, a handler).
- Webhook pattern with receipts: the Polar webhook.
- Screens: `schedule` (`timezone`, `from`, `to`, `slots`, `accounts`, `rules`; none live), `settings.accounts`
  not live.
- No Zernio code, no `social_accounts`, no `schedule_slots`.

## 4. Global constraints

- Every write through an ownership-checking RPC; a pgTAP test per migration and per transition; regenerate
  `supabase/schema/current.sql`. **Migration prefix for this phase: `20261230`.**
- Nothing goes out without an approved card for that content, time, account and platform fields; the publish order
  checks the snapshot again right before calling Zernio.
- The adapter publishes only the founder's own posts: no likes, follows, comments, replies, DMs or multiple accounts
  per platform.
- Zernio's API key and webhook secret come from env only (`ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`); a vendor's
  secret never goes to another vendor (the rule of the `llm-provider-keys` skill). No tokens of the
  founder's platforms in our database.
- Files never pass through Next.js; the worker streams media with the explicit format allowlist.
- Peak RAM per worker job < 2 GB holds for `publish_media` (it streams; measure once).
- English in all user-facing text; landing and card copy say "you approve when it posts".

## 5. Tasks

| Task | Session | What | Waits on |
|---|---|---|---|
| **A0** | A | **Contracts first:** migration skeleton `social_accounts`, `zernio_profiles`, `schedule_slots`, `zernio_receipts`, `approvals.ref_kind` `schedule_slot`, task kind `publish_media`; schedule card snapshot type; screen types for `schedule.*` and `settings.accounts` | — |
| **B0** | B | **Contracts first:** `lib/departments/publish/types.ts`: `publish(deliverable, slot) → { status, externalId, url, error }`, `connectLink(platform)`, `disconnect(accountId)`, `creatorInfo(accountId)` (TikTok fields); a fake Zernio with the same interface | — |
| A1 | A | Slots and cards in SQL: `schedule_propose` (default slots as data, gap 3 h, daily caps, short vs long video), `approval_decide` for `schedule` (approve, change time/account → supersede, cancel), expiry at the slot time | A0 |
| A2 | A | Firing: `schedule_claim_due` (lease, window, `missed` + new card), `publish_post` order kind, Modal `sweep` calls it; status transitions from the webhook RPC; kill switch | A1, B0 |
| A3 | A | Loaders: `schedule.*`, `settings.accounts`; flip `live`; event rule: approved `post`/`short` → `schedule_propose` | A1 |
| A4 | A | Acceptance (F11) with screenshots of Schedule, Settings → Accounts and a schedule card at 1440 and 390 | all |
| B1 | B | Zernio client (`lib/departments/publish/zernio.ts`): profiles, connect link, accounts, posts with `scheduledFor` handled by us (we post at fire time), presigned media, creator info; typed errors; retries with the slot's idempotency key | B0, owner gate |
| B2 | B | Connect flow routes: `POST /api/v1/accounts/connect` (returns Zernio's link), callback, `DELETE /api/v1/accounts/[id]`; zod, rate limits, English errors | B1, A0 |
| B3 | B | `publish_post` handler in the CMO runner: re-check the snapshot, start `publish_media` for videos and wait for it, post, record the external id; intent fallback when no account | B1, A2 |
| B4 | B | Worker task `publish_media` (`packages/engine/opencmo/worker/publish_media_task.py`): signed download → streamed PUT to the presigned URL, no full file in memory, explicit format; test with the fake server; peak RSS measured | A0 |
| B5 | B | Webhook route `/api/webhooks/zernio`: signature, receipts (replays refused), calls A's status RPC | A2 |
| C0 | C | Schedule card body on A0's types with fixtures: preview, platform, account picker, time in the founder's timezone, TikTok fields (privacy from creator info, toggles, AI-generated label off by default with one line of help), change time, cancel; failed and missed states with Retry | A0 |
| C1 | C | Settings → Accounts live: connect buttons per platform, connected handle and avatar, disconnect with confirm | B2, A3 |
| C2 | C | Schedule page live: calendar with times, drag to move (calls the change-time action, a new card appears), per-platform filter, published and failed markers | A3 |
| C3 | C | Copy: landing and cards say "you approve when it posts" (no "you post it"); the fallback card says why it is copy + open | C0 |
| C4 | C | e2e on live rows with the fake Zernio: approve a schedule card, drag a slot (card superseded), a failed post retried | C0–C2 |

**Milestones**
- **M1** contracts: A0 and B0 pushed and reviewed; the owner gate status known.
- **M2** connect and schedule: A1, A3, B1, B2, C0, C1 (accounts connect with the fake; schedule cards decide live).
- **M3** firing and acceptance: A2, A4, B3–B5, C2–C4; the planner reviews the whole PR.

## 6. Owner gates (before B1 calls the real API)

1. Zernio's TikTok audit: are posts public, or private until audited?
2. Zernio's real price per connected account, and what it charges for X posts (X's API price passes through).
3. Zernio's terms for a SaaS that posts on behalf of its own customers' connected accounts.
4. A Zernio account and API key in `.env.local` and in Vercel/Modal secrets; the webhook secret.
5. One real post to the owner's own test account, once, with the owner watching.

## 7. Review focus

- No post can go out without a matching approved card (content, time, account, platform fields); a stale card is
  refused; a moved slot supersedes its card.
- Never twice: lease + idempotency key; never late: `missed` after the window, never posted.
- No founder platform token in our database; disconnect really disconnects at Zernio.
- Webhook signature and replay checks; the route accepts nothing unsigned.
- `publish_media` streams within the 2 GB budget and reads user media with the allowlist.
- Pause stops waiting slots.
