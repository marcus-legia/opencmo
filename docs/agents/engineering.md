# Engineering: budgets, running, traps, layout, web rules

`CLAUDE.md` keeps the rules agents break most; [ARCHITECTURE.md](../../ARCHITECTURE.md) has the reasons.

## Hard budgets

> **Peak RAM per job < 2 GB**

Changes that break it are rejected. Measure with `/usr/bin/time -v` after any pipeline change.
Processing an upload (probe → remux → transcript) has no time budget yet: measure it on a long
upload and set one.

1. Never load video frames into Python memory — streaming `ffmpeg` subprocesses only.
2. No MoviePy or other frame-by-frame Python libraries.
3. `-ss` goes **before** `-i`.
4. Probe a hardware encoder with a real one-frame test encode before relying on it.
5. Cap parallel ffmpeg processes (~400 MB each).
6. User media is untrusted: read it with an explicit format or the demuxer allowlist
   (`USER_MEDIA_FORMATS` / `USER_INPUT`). ffmpeg sniffs content, so an "upload" can be an HLS
   playlist pointing at arbitrary URLs or local files.

## Running

```bash
npm install
npm run dev                         # Docker → local Supabase → Next.js + worker (127.0.0.1:3000)

npm run db:reset && npm run db:test # migrations + pgTAP
npm run typecheck && npm run build
(cd apps/web && npx tsx scripts/bundle-budget.mts)  # first-load JS of the loop's pages vs bundle-budget.json
(cd apps/web && npm run test:e2e:visual)   # the loop's screenshots; baselines come from CI (spec header)
(cd apps/web && ANALYZE=1 NEXT_PUBLIC_OPENCMO_UI=v2 npm run build)  # .next/analyze/client.html: which library a route's JS comes from
cd apps/web && npm run check:contracts && npm run test:e2e
```

Engine (use `.venv312`):

```bash
cd packages/engine
set -a && source ../../.env.local && set +a   # the engine does not read .env itself
.venv312/bin/opencmo doctor
.venv312/bin/python -m pytest -q && .venv312/bin/python -m ruff check .
```

Use the pinned Supabase CLI version from CI, not `npx supabase` (a newer CLI builds a storage
schema the running storage container rejects with `42P10`). Run heavy suites one at a time.

`test_web_sql_concurrency` fails while `npm run dev` is running — the dev worker claims its
tasks first.

## Verify by looking

Green tests don't prove a video is usable; the worst failures are silent (captions off-screen,
a master with no video frames, an export with no sound). After touching the master, captions,
render or export, extract a frame from the full-size file (not `*.preview.mp4`) and look at it.

## Known traps

- A Scribe failure does not fail an upload: the video is published without a transcript and
  the editor shows "no speech".
- Face tracking does not fail an upload either: without the engine's `[face]` extra, the model, or
  `libegl1`/`libgles2`, the master is published framed in the centre (speaker possibly half cut).
- Both fallbacks write a code in the job's manifest `warnings` (`transcript_failed`, `framing_centre_*`); owners read
  them under Warnings at `/app/settings/failures`, and the hourly `/api/cron/failures` sends every failure group and
  warning of the last hour to Sentry (one issue per group).
- A failure with a clean message (a job or run that ends `failed`) never reaches Sentry: owners read them at
  `/app/settings/failures`. A production deploy is checked by `.github/workflows/post-deploy.yml`, which does nothing
  until the repository variable `PRODUCTION_URL` is set.
- pgTAP `320_advisor_guard` fails a migration whose policy calls `auth.uid()` (or `current_setting()`) per row instead
  of `(select auth.uid())`, whose function has no `search_path`, or whose trigger function users can call.

## Layout

```
packages/engine/        Python engine (CLI + Modal worker); knows nothing about the web
packages/contracts/     JSON contracts shared by Python and TypeScript (ai-models.json = model catalog)
packages/clip-doc/      clip document schema (zod), validation, migrations
packages/editor-core/   operations on the document — the ONLY write path (buttons, API, agent)
packages/clip-render/   Canvas 2D renderer (browser + Node)
packages/clip-export/   server export: document → MP4 (task `render_document`)
packages/clip-motion/   explainer animations (Remotion) rendered on the worker
packages/clip-icons/, clip-media/, clip-assets/, editor-parity/
packages/skills/       style skills: markdown + frontmatter → generated index; gated by editor-core/capabilities.ts
apps/web/               Next.js app; app/api/v1 = API (reads under RLS, writes via RPC)
  lib/agent/            the editor assistant (tools = editor-core ops)
  lib/generate/         AI media generation
  lib/cmo/              Sales, Post and the job engine
  lib/mcp/              MCP server (API keys → short-lived user JWT under RLS)
  app/api/webhooks/     inbound webhooks: payments (Creem) and Zernio, each → one atomic RPC
  lib/supabase/admin.ts service role — only webhooks, crons, CMO runner, MCP key lookup, Assistant ledger, caption translation refunds, health probe (`lib/ops/health.ts`)
supabase/migrations/    at the repo ROOT; every migration needs a pgTAP test in supabase/tests/
scripts/dev.mjs         one-command dev stack
```

## Web rules

1. Every write goes through an ownership-checking RPC; charging credits and creating work
   happen in one transaction.
2. Validate in three layers: zod → RPC limits → worker parsing.
3. Files never pass through Next.js (Vercel caps bodies at 4.5 MB): TUS uploads with a
   reservation, signed-URL downloads.
4. Hash settings with JCS (RFC 8785) so Python and TypeScript agree.
5. Money only moves through `credit_hold` / `credit_settle` / `credit_refund` /
   `credit_held`. After a new migration, regenerate `supabase/schema/current.sql` with
   `scripts/dump-schema.sh`.
6. A new table, view or sequence grants nothing to `anon` or `authenticated`: grant what the app reads (`select`
   only) in the same migration and add it to `supabase/tests/323_table_grants`.
