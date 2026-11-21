# Ferreto: architecture

How the system is built and **why**. Product rules and the owner's decisions are in `CLAUDE.md` and `docs/agents/`;
this page is the technical shape. Read §3 before adding a dependency or touching media. Package, SQL and env names keep
the old name (`@opencmo/*`, `OPENCMO_*`).

## 1. System shape

```
Browser ──► Next.js app + /api/v1 (Vercel) ──► Supabase (Auth · Postgres/RLS · Storage · Realtime)
                 ▲                                   ▲
                 │ cron + run calls                  │ claim_* (leased queue), write results
          Modal clock ─────────────── Modal worker (Python + ffmpeg + Node exporter + Remotion)
Your Claude ──► MCP server (Modal) ─────────────────┘  the editor's tools, under the user's JWT
```

One system: Next.js + Supabase + a Modal worker. No second runtime.

| Question when adding a feature | Where it goes |
|---|---|
| Touches ffmpeg, a GPU or large media files? | Python on Modal (`packages/engine`) |
| Everything else: Sales, Post, agents, API, editor | TypeScript (`apps/web`, `packages/*`) |
| Writes data or moves credits? | A `security definer` RPC in Postgres |

TypeScript and Python meet only through `packages/contracts/*.json` and JCS (RFC 8785) hashes. The editor packages run
in the browser and on the server, and the Assistant's tools are `editor-core` ops, so a Python backend would need a
second copy of them: the backend stays TypeScript.

**Why Modal for media.** Supabase Edge Functions cannot run subprocesses (no ffmpeg); Vercel Functions have no ffmpeg,
a small `/tmp` and the wrong pricing for batch video. Modal gives a custom image, per-second billing and scale-to-zero.
The worker (`packages/engine/modal_app.py`) has two ways in: a `submit` endpoint the web calls when a job starts, and
`sweep()` every minute as the safety net for anything left `queued`.

## 2. Data and security

- **Two actors, two paths.** Signed-in users go through RLS; the worker, crons and webhooks use the service role
  (`apps/web/lib/supabase/admin.ts`, server-only). Every user write is an RPC with an ownership check: RLS alone cannot
  make "charge credits + create work" atomic. The MCP server maps a personal API key to a five-minute user JWT, so its
  tools run under RLS too.
- **Three validation layers:** zod in the route → limits in the RPC → parsing in the worker. The SQL layer is the one
  a client cannot skip.
- **Leased queue.** `jobs`, `tasks` and `cmo_runs` share one pattern: `claim_*` with `for update skip locked` sets
  `lease_until` and an `attempt_id` (a fencing token); a stale attempt cannot complete. Nothing stays `running`: every
  failure ends `failed` and refunds what was held.
- **Append-only ledger.** `credit_ledger` is insert-only; `profiles.credit_balance` is kept by trigger. Money moves
  only through `credit_hold` / `credit_settle` / `credit_refund` / `credit_held`.
- **Immutable revisions.** `clip_revisions` is insert-only; an export points at one revision. `document_hash` is
  computed by SQL and sent back verbatim, so there is one hash implementation.
- **Storage by uid.** The first path segment is the user id; every bucket is private; reads are short-lived signed
  URLs. Files never pass through Next.js (Vercel caps bodies at 4.5 MB): TUS uploads with a reservation.
- **Retention is a queue.** Deleting a project or an account records every object in `storage_deletions` (no foreign
  keys, so its rows survive the cascade), deletes the files, then the rows. Accounts that never pay are deleted 30
  days after sign-up the same way.
- **Outside text is data.** Threads, posts and websites are cleaned (`lib/cmo/untrusted.ts`) and wrapped in tags with
  an instruction to ignore directions inside; they only reach model calls with no tools and schema-held output.
- **A new table grants nothing** to `anon`/`authenticated` beyond the `select` the app needs
  (`supabase/tests/323_table_grants`). Each migration has a pgTAP test; `supabase/schema/current.sql` is regenerated
  with `scripts/dump-schema.sh`.

## 3. Media budget

> **Peak RAM per job < 2 GB.** A constraint, not a goal. Measure with `/usr/bin/time -v`.

1. Never load video frames into Python: streaming `ffmpeg` subprocesses only. No MoviePy or other frame-by-frame
   library (one raw 1080p frame is ~6 MB).
2. `-ss` before `-i` (input seeking; a late seek is ~10× faster).
3. `ffmpeg -encoders` lists what was compiled in, not the hardware: probe a hardware encoder with a one-frame encode.
4. Cap parallel ffmpeg processes (~400 MB each).
5. User media is untrusted: ffmpeg picks a demuxer from content, so an "upload" can be an HLS playlist that fetches
   URLs or local files. Read it with a forced format or the allowlist (`USER_MEDIA_FORMATS` / `USER_INPUT`).

**Upload pipeline.** Upload is the only way in (no link import, no clipping of outside video). Probe the upload →
settle credits on its real length → remux once into the editor master (`-c copy`) → transcript (ElevenLabs Scribe; a
failure publishes without words) → publish one `full` clip in one transaction. Face framing falls back to the centre
without the `[face]` extra. Both fallbacks write a warning code into the job manifest. Everything after that is a
document edit.

## 4. The editor (Video)

- **One document.** A clip is a JSON document validated by `packages/clip-doc` (zod, with a JSON Schema for Python);
  it is the only thing stored (`editor_projects.document`).
- **One write path.** Buttons, the API, the Assistant and MCP all call `packages/editor-core` operations.
- **One renderer.** `clip-render` draws Canvas 2D with the same code in the browser and in Node (`@napi-rs/canvas`);
  golden images in `editor-parity` keep both pixel-close. `clip-export` (task `render_document`) renders segments in
  parallel on the worker and joins them with ffmpeg; users' machines never encode.
- **Motion is Remotion only** (`clip-motion`, tasks `render_motion` / `motion_preview`). three.js and Lottie were
  removed from the editor on 2026-10-24; `three` remains only for the blog's header scene.
- The editor opens in its own tab from the app's top bar and targets desktop browsers (feature detection, not browser
  names; phones get a guidance screen).

## 5. The app: Sales, Post and the job engine

Tabs: **Feed · Sales · Post · Analytics · Editor ↗** (`components/today/TopBar.tsx`). The business comes from its
website: `onboard` reads it into four `marketing_documents`, which every job reads.

**Job engine** (`apps/web/lib/cmo/`). A job is a row in `cmo_runs`, claimed with a lease and run in TypeScript on
Vercel (`jobs/runner.ts`). `loops.ts` declares which loops run when; `cmo_job_daily_limit` caps each kind and refuses
unknown ones. Kinds today: `sales_scan`, `sales_reply_drafts`, `plan_week`, `post_draft`, `write_caption`,
`repurpose_post`, `publish_post`, `pull_metrics`, `competitor_research`, `distill_ratings`, `summarize_memory`,
`review_week`.

**Sales** (`jobs/sales-scan.ts`, `lib/cmo/social/`). Queries from the founder's pains and competitors → conversations
on Reddit (last month), Hacker News, Facebook groups and Threads → a score per thread whose parts need a real quote from
the thread (no quote, zero points) → a reply draft for the best ones, plus DM and email drafts → cards. Reddit and the
post readers go through ScrapeCreators, or LurkAPI when `LURK_API_KEY` is set (`social/scrapecreators.ts`); Facebook
groups and Threads are found through Google search first, then read one by one. Every scan saves what people said to
the **Library** (`lib/cmo/library.ts`); each person is tracked through `reach.ts` (contacted → replied → call →
customer) so nobody is contacted twice. There is no posting step: the founder opens the thread and sends it.
Scans run on the founder's cadence (Mon/Wed/Fri by default) or on request. The free tier is one real scan.

**Post.** `plan_week` plans a week of posts for X, LinkedIn and Threads (`packages/contracts/platforms.json`) from the
Library; `post_draft` writes one core post per slot that serves every platform of the slot. Every prompt that writes
for a reader embeds `NO_AI_SLOP` (`lib/cmo/skills/no-ai-slop.check.ts`).

**Approvals and publishing.** Every card is a row in `approvals` with a snapshot (JCS content hash, price, time,
account), decided through one RPC, `approval_decide`. An approved post gets a `schedule_slots` row in the founder's
timezone and is published at that time through Zernio (`lib/departments/publish/adapter.ts`; `social_accounts` holds
Zernio ids, never tokens), or as an intent link when no account is connected. Autopilot (per platform, single posts
only) approves an untouched card through `approval_auto_decide`, which calls the same `approval_decide`.

**Memory.** Corrections the founder approved (`cmo_corrections`) → the four documents → weekly lessons
(`cmo_lessons`) → events (`cmo_memories`, by topic, with expiry). Voice notes learned from edits are read through
`voice_notes_for`.

**Gates.** `OPENCMO_CMO_PAUSED=1` stops every founder's jobs within one sweep (`lib/cmo/pause.ts`); a founder can pause
their own. Plan usage limits refuse new paid kinds at 100%. A daily card budget holds extra cards for the next day.

## 6. Clock, charging, providers

**Modal is the only clock** (`apps/web/vercel.json` has no crons). Both directions authenticate with `CRON_SECRET`.

```
sweep()       every minute  ──POST─▶ /api/internal/cmo/run   one call per claimable run (max 10), plus due slots and stuck work
cmo_schedule  hourly at :05 ──GET──▶ /api/cron/cmo           enqueue the loops due in each founder's morning
cmo_digest    hourly at :02 ──GET──▶ /api/cron/cmo-digest    the morning email (people asking first) in each timezone
                            ──GET──▶ /api/cron/failures      then: failure groups and warnings of the last hour → Sentry
cleanup       03:00 UTC     ──GET──▶ /api/cron/cleanup
```

Routes run within Vercel's 300 s; longer work defers itself (`cmo_defer_run`).

**Charge before running.** A paid job shows one estimate; the founder confirms once; `credit_order_open` holds it,
each piece draws from it (`credit_order_draw`), the close returns the rest, and `credit_orders_reap` closes one left
open for a day. Only what failed or was blocked is refunded.

| Function | Provider |
|---|---|
| Every LLM call | Claude: Sonnet to write and plan, Haiku for small tasks (`lib/cmo/agents/registry.ts`) |
| Reading Reddit, Threads, Facebook, Google | ScrapeCreators or LurkAPI; Hacker News through its own search |
| Image and video prompts | Creem Moderation API before credits are held; outputs reviewed by Haiku vision and fal NSFW against `packages/contracts/creem-policy.json` |
| Image, video, voice, sound | fal |
| Transcripts | ElevenLabs Scribe |
| Posting and post metrics | Zernio (webhook at `/api/webhooks/zernio`) |
| Payments | Creem (webhook at `/api/webhooks/creem`); prices and credits in `billing_catalog` |
| Email · push · errors | Resend · VAPID · Sentry |

Every paid provider call is recorded in `provider_usage` with a daily cap per founder; the owner's Costs page
(`/app/settings/costs`) shows the spend, the live switches (`lib/ops/switches.ts`) and a key check per provider.
Failures, stuck work and fallbacks are on `/app/settings/failures`; what to do during an incident is
`docs/runbooks/incident.md`.

## 7. Deploy order

1. Migrations: `supabase db push` (the owner approves; a migration is never rolled back, only fixed forward).
2. Modal secrets (`opencmo` with `OPENCMO_WEB_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `CREEM_API_KEY`,
   `OPENCMO_ENV=production`; `fal-secret`; `opencmo-voice`; `opencmo-motion`; `opencmo-mcp`), then `modal deploy`.
   Check with `packages/engine/check_deploy_env.py`.
3. Vercel env: the same Anthropic key and `CRON_SECRET`, Creem, Zernio (`OPENCMO_PUBLISH_LIVE=1`), Resend
   (`OPENCMO_EMAIL_LIVE=1`), ScrapeCreators or Lurk, VAPID; merge to deploy. `.github/workflows/post-deploy.yml` checks
   the deploy once `PRODUCTION_URL` is set.
