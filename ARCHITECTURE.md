# OpenCMO — Architecture

This document records the technical decisions and **the reasons** behind them. Read §2
before adding any dependency.

---

## 1. System shape

A web app. Heavy work runs on a serverless worker, never inside an HTTP request.

```
┌──────────────┐  create job  ┌──────────────┐
│  Next.js     │─────────────▶│  API routes  │
│  (Vercel)    │              │  (Vercel)    │
└──────┬───────┘              └──────┬───────┘
       │ realtime                    │ insert jobs(status='queued')
       │ job status                  ▼
       │              ┌───────────────────────────────────────────┐
       └─────────────▶│                Supabase                   │
                      │  Auth · Postgres · Storage · RLS · Queue   │
                      └───────────┬───────────────────▲───────────┘
                       claim_next_job()               │ write clips + status
                                  ▼                   │
                      ┌───────────────────────────────┴───────────┐
                      │        Python worker (Modal)              │
                      │        scale-to-zero, ships ffmpeg        │
                      │  transcript → LLM → ffmpeg render         │
                      └───────────────────────────────────────────┘
```

The queue needs no separate service: the `jobs`/`tasks` tables plus `claim_*` functions using
`for update skip locked` are enough at this scale.

**Why the worker cannot live in Supabase or Vercel** — a technical constraint, not a taste:

| | Can it run ffmpeg? |
|---|---|
| Supabase Edge Functions | **No.** Deno blocks subprocesses; also a 400 s wall-clock and 2 s CPU limit |
| Vercel Functions | Duration is enough, but the runtime has no ffmpeg, `/tmp` is small, and web-request compute pricing is the wrong tool for batch video |
| **Modal** | Right tool: a custom image with ffmpeg, per-second billing, true scale-to-zero |

Modal is Python-native: the image is defined in Python, so there is no Dockerfile or registry
to manage, and deploying is one command. No jobs means no cost.

The worker lives in `packages/engine/modal_app.py` and has **two entry points**, on purpose:

| | When | Why |
|---|---|---|
| `submit` endpoint → spawn | the web app calls it when the user starts a job | main path, no delay |
| `sweep()` | cron every minute | safety net: picks up jobs stuck in `queued` if the web call failed or the network dropped |

A job **never stays in `running`**: every failure path ends in `failed` and **refunds the
credits**. The ledger is append-only, so a refund is a new credit row, not an edit of the
debit.

---

## 1b. Web data model and security

### Why Next API + Supabase + Modal, not FastAPI on Modal

| Option | Why rejected |
|---|---|
| FastAPI on Modal as the main API | One more process owning auth, sessions, CORS and rate limits — all of which Supabase + Next already provide. Modal's scale-to-zero also means the first request pays a cold start, even for a one-row read |
| Supabase Edge Functions | Deno blocks subprocesses: no ffmpeg (see §1) |
| **Next API routes + Supabase + Modal worker** | Chosen. Heavy work on Modal, light work where the session already is, and RLS is the single permission layer that has to be right |

### Four data decisions

**Immutable revisions.** `clip_revisions` is insert-only (a trigger blocks updates). A queued
export points at a specific revision; editing a revision would change the content of a file
the user thinks they already locked. Drafts are a pointer to "which revision this clip is on".

**Leased task queue.** `tasks` and `jobs` share one pattern: `claim` sets `lease_until` and an
`attempt_id`, the worker heartbeats, and a reconciler reclaims expired leases. `attempt_id` is
a fencing token — a worker that lost its lease can come back and try to write, but
`complete_task` rejects the stale attempt.

**Hash-based dedupe.** `settings_hash` is the sha256 of the settings canonicalized with JCS
(RFC 8785). Same clip + same settings renders once. Python and TypeScript must produce **the
same string**, which is why JCS and not `JSON.stringify`.

**Append-only ledger.** `credit_ledger` is insert-only; refunds are new rows.
`profiles.credit_balance` is a materialized balance updated by trigger in the same
transaction, so reading a balance is O(1). Only the credit module (`credit_hold`,
`credit_settle`, `credit_refund`) writes ledger rows, each tagged with the `(ref_kind,
ref_id)` it belongs to.

### Security model

**Two actors, two paths.** Signed-in users go through RLS; the worker goes through the
service role. There is no third path. Every user write is a `security definer` RPC with an
ownership check — RLS alone is not enough because many operations (charge credits + create
job) must be atomic. The MCP server maps a personal API key to a five-minute user JWT, so its
tools also run under RLS.

**Storage by uid.** The first path segment is always the user id, so a storage policy is a
string comparison, not a query. All buckets are private; reads are short-lived signed URLs.

**Three validation layers.** zod in the route → limits in the RPC → parsing in the worker.
The repetition is deliberate: any layer may be the only one left after a refactor, and the
SQL layer is the one a client cannot skip.

**Untrusted media.** ffmpeg chooses a demuxer from file content, so a user "video" can be an
HLS playlist that makes the worker fetch arbitrary URLs or read local files. User media is
read through stdin (`image2pipe`), with a forced format (`-f mov`), or with a demuxer
allowlist (`USER_MEDIA_FORMATS`); `.json` uploads (formerly Lottie) are refused unread.

**Retention is a queue, not a sweep.** Deleting an expired project first records every object
path in `storage_deletions`, then deletes the files, and deletes the rows last. That table
deliberately has no foreign keys: its rows must survive the very cascade that created them
(deleting an account removes jobs, clips and tasks in one transaction). Accounts that never
make a purchase are deleted 30 days after sign-up through the same queue.

---

## 2. Resource budget — hard constraints

> ### Peak RAM per job < 2 GB

This is a **constraint**, not a goal. Changes that break it are rejected. Processing an upload
(probe → remux into the editor master → transcript) has no time budget yet: measure it with
`/usr/bin/time -v` on a long upload and record it here.

RAM matters twice in the cloud: it sets the container size, and the container size sets the
bill.

### Non-negotiable rules

1. **Never load video frames into application memory.** Every transform is a streaming
   `ffmpeg` subprocess; ffmpeg uses constant memory regardless of video length.
2. **No MoviePy** or any frame-by-frame Python library. MoviePy keeps frames as numpy arrays;
   one raw 1080p frame is ~6 MB, and a few hundred of them is gigabytes.
3. **No Whisper `large` fp32 locally** — the weights alone are ~6 GB. Transcription uses an
   API.
4. **Cap parallel work** by available cores and memory.

> Full RAM → swap → everything slows down by an order of magnitude. Most "30 minutes per
> video" numbers from older tools are a machine fighting swap, not computing. **Fix RAM and
> speed follows.**

---

## 3. Pipeline

An upload becomes **one editable project**: the whole video, its master and its transcript.
The clipping pipeline (link downloads, AI moment selection, vertical clips) was removed on
2026-10-20 — payment providers forbid clipping tools and content downloaders.

```
1. Probe the upload through a signed URL (header only)     │ refuse what the editor cannot hold
                    ↓
2. Settle credits on the real length
                    ↓
3. Download the user's own upload once → remux into the     │ -c copy: I/O, not CPU
   editor master
                    ↓
4. Extract audio → speech-to-text (Scribe)                 │ a failure publishes without words
                    ↓
5. Publish ONE `full` clip: settings, master, transcript    │ one transaction
```

Everything after that — cuts, captions, B-roll, motion, generated shots — is a document edit,
rendered by `clip-render` and exported by `clip-export` on the worker.

---

## 4. ffmpeg traps

**Position of `-ss`** — for a seek near the end of a long video this is a 10× difference:

```bash
# WRONG — decodes from 0 to 1800 s before cutting
ffmpeg -i in.mp4 -ss 1800 -t 20 out.mp4

# RIGHT — seeks straight to the position (input seeking)
ffmpeg -ss 1800 -i in.mp4 -t 20 out.mp4
```

> ⚠️ **`ffmpeg -encoders` lists what was COMPILED IN, not the hardware you have.** A typical
> build lists `h264_nvenc` on a machine with only an Intel iGPU, and calling it fails at run
> time. Probe any hardware encoder with a real one-frame test encode before relying on it.

**User media is untrusted.** ffmpeg sniffs content, so an "upload" can be an HLS playlist
pointing at arbitrary URLs or local files: read it with an explicit format or the demuxer
allowlist (`USER_MEDIA_FORMATS` / `USER_INPUT`).

---

## 5. Stack

### Web (`apps/web`)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js App Router + TypeScript | |
| Auth | **Supabase Auth** (Google OAuth) | |
| DB | **Supabase Postgres** | |
| Storage | **Supabase Storage** | **RLS applies to files too** — see below |
| Queue | **Postgres** (`claim_*` functions) | No separate service; `for update skip locked` handles contention |
| Billing | Creem (merchant of record) | Handles VAT/sales tax |
| Errors | Sentry (optional) | |
| Landing hero 3D | `three` (pinned in `apps/web`; marketing pages only, not the product) | Loaded with `import()` after first paint; static SVG fallback without WebGL or with reduced motion |

**One provider for auth + DB + storage + queue.** The strongest reason is not price but that
**Row Level Security applies to files**: "only the owner can read their clips" is a SQL
policy, not permission logic we write (and can get wrong) in the app. `lib/storage.ts` wraps
storage behind a few functions, so the provider can still be swapped.

### Engine (`packages/engine`)

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.11+ | The video and AI ecosystem lives here |
| Video processing | `ffmpeg` subprocess | Streaming, constant RAM |
| Transcript | ElevenLabs Scribe (word timestamps) | Upload capped at 24 MB |
| Runtime | Modal | Scale-to-zero |

**Why two languages:** video processing and AI live in Python; auth, billing and UI live in
TypeScript. Forcing one language costs more than it saves.

---

## 6. Video sources

OpenCMO only edits video the user made. **Upload is the only way in** (resumable, straight to
Storage). There is no link import: a link plus a full download is the shape of a content
downloader, and it was removed with the clipping tool.

---

## 7. Two levers built in from day one

1. **Storage behind a small wrapper** (`lib/storage.ts`) — the app never calls a provider SDK
   directly, so the storage provider can be swapped when egress costs demand it.
2. **Low-resolution previews + full-quality downloads.** Every view of a project card is
   egress; a short low-bitrate preview cuts it 5–10×.

Plus: **clips are deleted 7 days after a project finishes.** It keeps storage bounded and
avoids keeping copies of video indefinitely.

---

## 8. Repository layout

```
opencmo/
├── apps/
│   └── web/                      # Next.js
│       ├── app/                  # pages + app/api/v1 routes
│       └── lib/
│           ├── storage.ts        # storage wrapper — the app never calls the SDK directly
│           ├── agent/            # the editor assistant
│           ├── generate/         # AI media generation
│           ├── cmo/              # the AI CMO job engine
│           ├── mcp/              # MCP server
│           └── supabase/
├── packages/
│   ├── clip-doc/                 # clip document JSON — the only thing persisted (§10)
│   ├── clip-render/              # renders the document: Canvas 2D in browser + Node
│   ├── clip-export/              # server export: document → MP4
│   ├── clip-assets/              # media library manifest
│   ├── clip-icons/ clip-media/ clip-motion/
│   ├── editor-core/              # operations on the document — the only write path
│   ├── editor-parity/            # golden images + comparison scripts
│   ├── contracts/                # JSON contracts shared by Python and TypeScript
│   └── engine/                   # Python engine
│       ├── opencmo/
│       │   ├── pipeline.py       # orchestration; step order is the main optimization
│       │   ├── media/            # probe, encoder detection, ffmpeg command building
│       │   ├── steps/            # download, transcribe, select, reframe, captions, render
│       │   ├── ai/               # generation providers + moderation
│       │   └── worker/           # queue loop: claim, process, render/export/generate
│       ├── modal_app.py
│       └── tests/
└── supabase/                     # migrations, pgTAP tests, local config
```

**The engine is a standalone CLI that knows nothing about the web.** It takes a URL or file
and returns clips. It can be tested without any web infrastructure, and deploying to Modal is
only packaging.

---

## 9. The editor: a document, rendered the same way everywhere

The editor's single source of truth is a **clip document**: JSON validated by a zod schema
(`packages/clip-doc`), with a generated JSON Schema for Python. It is the only thing stored
(`editor_projects.document`).

- **Writes**: every write path — buttons, API routes and the AI assistant — is an
  `editor-core` operation on the document, validated by `validate()`. There is no other way to
  change a clip.
- **Rendering**: `clip-render` draws the document to Canvas 2D with the same code in the
  browser (preview, assistant frame captures) and in Node (`@napi-rs/canvas`, export). Golden
  images in `packages/editor-parity` keep both targets pixel-close.
- **Export**: the `render_document` task — the Python worker fetches exactly the media the
  document needs, the Node exporter (`clip-export`) renders segments in parallel and joins them
  with ffmpeg, and the worker applies the watermark for free accounts. Users' machines never
  encode.
- **Revisions**: `snapshot_editor_revision` checks `document_hash` (sha256 of the document
  text, computed by SQL and returned on every read/write). The client sends back the exact
  string the server returned, so there are no two hash implementations to keep in sync.

The worker publishes an upload as one document over its master; every export goes through the
document.

The editor targets desktop browsers (Chrome, Edge, Safari 17+, Firefox). `DeviceCheck` detects
**features**, not browser names; phones get a guidance screen.

---

## 10. Motion: one renderer (Remotion)

Explainers and motion clips are Remotion scenes the Assistant writes, rendered by `clip-motion` in
its own CPU container (`render_motion`, `motion_preview`) and placed on the clip like any generated
video. 3D scenes (three.js on an L4 GPU, `clip-three`) and Lottie layers (Skottie in the exporter,
CanvasKit in the preview) were removed on 2026-10-24: they were two more renderers to keep secure
and working, and no saved document used them. Depth comes from CSS perspective in Remotion; small
motion from drawn SVG (`kit.drawOn`, `kit.travel`, `Streak`).

---

## 11. AI CMO: the brain, its departments, scheduling, memory and providers

First built in PR #21; the departments, the spine and the gates in P1–P6 and the CMO review (#169–#180). The design
pages with code paths are in [`docs/architecture/`](docs/architecture/README.md) (built, `main` at `4f70a59`).

**Order of work (owner, 2026-11-08): the AI CMO first, the editor last.** The product follows one loop: business
information → Writer → approval → Video → approval → Post. `/video` (the full AI video) is hidden in the web app; the
code, the MCP tool and the evals stay.

### Language boundary

> **TypeScript for product logic. Python only for video. Postgres for data and money.**

| Question when adding a feature | Answer |
|---|---|
| Does it touch ffmpeg, a GPU or large video files? | Python on Modal (`packages/engine`) |
| Everything else: agents, CMO jobs, API, editor | TypeScript on Vercel (`apps/web`, `packages/*`) |
| Does it write data or move credits? | An RPC in Supabase |

The editor packages (`editor-core`, `clip-doc`, `clip-render`) run in the browser and on the
server, and the editor assistant's tools are `editor-core` ops. A Python backend would need a
second copy of them, so the backend stays TypeScript. TypeScript and Python meet only through
`packages/contracts/*.json` and JCS hashes.

### Scheduling: Modal is the only clock

`apps/web/vercel.json` has no crons. Modal (`packages/engine/modal_app.py`) keeps time and
dispatches; CMO jobs stay TypeScript and run on Vercel, in parallel:

```
Modal cmo_schedule  (00:05 UTC daily) ──GET──▶ /api/cron/cmo           enqueue the loops due today
Modal cmo_digest    (every hour)      ──GET──▶ /api/cron/cmo-digest    the morning digest in each founder's timezone
Modal sweep()       (every minute)    ──POST─▶ /api/internal/cmo/run   ×N, one per claimable run (max 10)
                                                also: due schedule slots, Studio steps, stuck turns and credit jobs
Modal cleanup       (03:00 UTC daily) ──GET──▶ /api/cron/cleanup
```

- Enqueue stays **once a day** on purpose: the loops are daily and `cmo_enqueue` only dedupes runs
  still queued or running, so enqueuing more often would run a finished loop again.
- `/api/internal/cmo/run` answers 202 and drains inside `after()`; each call claims its own lease,
  so an extra call does nothing. `sweep()` counts claimable runs with the same rule as
  `claim_cmo_run` (`opencmo/worker/cmo_dispatch.py`).
- Both directions authenticate with `CRON_SECRET`; Modal also needs `OPENCMO_WEB_URL`.
- The routes run on Vercel Hobby (300 s a request): an Assistant step still streaming at 280 s is cut
  (`STEP_DEADLINE_MS`, #178), and longer CMO work defers itself (`cmo_defer_run`).

### The spine: orders, deliverables, approvals, slots

| Table | Holds |
|---|---|
| `work_orders` | the week's tree: one root a week, an order per plan item, children per department; `depends_on`, budget, status. It sits **beside** `cmo_runs` (the job queue) and follows its run |
| `deliverables` | what a department made (`post`, `caption`, `video`, `short`, `slideshow`, `image`, `reply`, `insight`, `metric`); it wraps `content_items`, `opportunities`, `cmo_insights` and `clips` |
| `approvals` | every card the founder decides, with a snapshot (JCS content hash, price, time, account); one `approval_decide` RPC; 11 kinds |
| `schedule_slots` | a time per platform for an approved deliverable, in the founder's timezone (`profiles.timezone`); `publish` (Zernio) or `intent` mode |
| `social_accounts` | the founder's connected accounts: Zernio ids only, never tokens |
| `credit_orders` | one hold per job the founder confirmed once (§"Charging" below) |

Event rules are SQL triggers on status changes (finished edit → `cut_shorts`; approved → schedule; due → publish;
posted + 24 h → measure). Studio work runs through one adapter (`apps/web/lib/departments/studio/adapter.ts`) under
the founder's short-lived JWT; publishing through one adapter (`apps/web/lib/departments/publish/adapter.ts`) on
Zernio for X, Threads, LinkedIn, TikTok, Instagram and YouTube, with the intent link as the fallback. The worker task
`look_check` draws frames of a finished export before any card; `publish_media` uploads media to Zernio.

### Memory in four tiers

| Tier | Where | Read by |
|---|---|---|
| 0. Corrections | `cmo_corrections`: rules from the founder's repeated edits, approved on a card | every writing job, first |
| 1. Profile | the four `marketing_documents` | every job and the chat |
| 2. Events | `cmo_memories` with `kind`, `topic`, `importance`, `expires_at` | each job reads its own topic + `general`, most important first, unexpired |
| 3. Lessons | `cmo_lessons`, one per topic per week | every job and the chat, before events |

`summarize_memory` (Sunday, free) writes the topic lessons; `review_week` writes the `general`
lesson. Skip reasons expire after 90 days; notes the founder typed do not. Voice notes learned from
approvals and edits are read through `voice_notes_for`, newer first.

### Weekly goal loop

`cmo_goals` holds at most one goal per week, counted in `posts`, `replies` or `views`.
The CMO proposes (chat tool `set_week_goal`, or `review_week` for next week); it becomes the goal
only when the founder approves the card in Approvals. `review_week` (Sunday, free) records the
result, writes the lesson and proposes the next goal; the week plan is planned around the approved goal. Chat tool
`get_run_result` lets the CMO check on work it handed out.

### Budgets and gates

- The weekly budget is a hard gate for runs the brain starts itself (`cmo_runs_budget_gate`); the brain's own runs
  holding over 40 % of it within an hour pause the brain.
- Kill switch: `OPENCMO_CMO_PAUSED=1` for everyone, Pause CMO per founder (`profiles.cmo_paused_at`).
- A daily card budget (`card_budget`, about ten new cards a founder's day); later cards are held for the next day.

### Video in the CMO

The CMO reaches video through Studio orders, never by driving the editor: a finished edit of the founder's own video
becomes 3 shorts (`cut_shorts`), a slideshow item becomes `write_slides` → `build_slideshow` (MP4 and a PNG set), and a
`build_video` order makes an AI video from Writer's brief (hidden for now, with `/video`). Video is only ever the
founder's own upload or made in the editor: no link import, no clipping of outside video.

### Charging: charge before running, then run in one go

A paid job shows one card with one price, the founder confirms once, and it runs to the end (owner, 2026-11-05).
`credit_order_open` holds the job's whole estimate; each piece draws its price from it (`credit_order_draw`); the
close gives back the rest; `credit_orders_reap` closes a job left open for a day. A Studio order holds a small
allowance before its team calls a model (`studio_order_hold`); an Assistant turn is billed for every credit it used
(overage), and a turn that opened an explainer job pays at most `agent_3d_hold_credits()` for its tokens.

### Providers: one per function

| Function | Provider | Called from |
|---|---|---|
| Agent LLM | Claude only (owner, 2026-11-05): Sonnet for the Assistant, CMO chat and drafting agents, Haiku for small tasks; one agent can be moved with `CMO_AGENT_<ID>_MODEL` | Vercel, Modal |
| Moderation | Creem's Moderation API for every image and video prompt (web before credits, worker again); the output (image or 3 video frames) reviewed by Claude Haiku vision and fal NSFW against Creem's rules (`packages/contracts/creem-policy.json`). No LLM checks a prompt | Vercel, Modal |
| Image, video, voice, sound generation | fal for every model, including Veo, Nano Banana and ElevenLabs (voice with word timestamps, sound effects, music); the direct ElevenLabs adapter stays only as a fallback | Modal |
| Transcripts | ElevenLabs Scribe | Modal |
| Posting and post analytics | Zernio | Vercel, Modal |
| Email · web push | Resend · VAPID (no provider) | Vercel |
| Social reading · payments · errors | ScrapeCreators (and Hacker News search) · Creem · Sentry | Vercel |

What each paid call costs us is recorded in `provider_usage` (micro-USD, priced when written) with a daily cap per
founder (`provider_spend_cap`); the owner's Costs page (`/app/settings/costs`) shows seven days of spend and the
switches of `apps/web/lib/ops/switches.ts`.

### Deploy order

1. Apply migrations (`supabase db push`).
2. Modal secret `opencmo`: `OPENCMO_WEB_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `FAL_KEY`, `ELEVENLABS_API_KEY`,
   `CREEM_API_KEY`, `OPENCMO_ENV=production`; then `modal deploy`. Check with `packages/engine/check_deploy_env.py`.
3. Vercel: the same `ANTHROPIC_API_KEY`, `CRON_SECRET`, Creem, Zernio, Resend and VAPID keys; merge to deploy.
4. Run `npm run cmo:eval -- --provider anthropic --yes` to grade the jobs on Claude.
