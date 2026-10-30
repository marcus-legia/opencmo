# Session B: publish adapter, connect, publish handler, media task, webhook

Plan: [`../2026-10-28-p4-schedule-publish-plan.md`](../2026-10-28-p4-schedule-publish-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/departments/publish/` (new: types, `zernio.ts`, `fake.ts`, `intent.ts`)
- `apps/web/app/api/v1/accounts/` (new: connect, callback, disconnect)
- `apps/web/app/api/webhooks/zernio/` (new)
- the `publish_post` handler under `apps/web/lib/cmo/jobs/publish-post.ts` (new)
- `packages/engine/opencmo/worker/publish_media_task.py` (new) and its tests

## Order

B0 → (push, M1) → B4 → B1 (after the owner gates; fake first) → B2 → B3 (after A2) → B5.

## Todo

- [x] **B0 Adapter interface (push first)**: `lib/departments/publish/types.ts`: `publish(deliverable, slot)` →
      `{ status, externalId, url, error }`, `connectLink(platform, returnUrl)`, `disconnect(accountId)`,
      `creatorInfo(accountId)`; `fake.ts` with the same interface (used by tests, e2e and acceptance, selected by
      `OPENCMO_PUBLISH_FAKE=1`); `intent.ts` (X intent, Threads web intent, LinkedIn/Facebook copy + open).
- [x] **B4 `publish_media` task**: signed download from Storage → streamed PUT to Zernio's presigned URL; explicit
      format and the demuxer allowlist where it probes; no full file in memory; test against a local fake server;
      measure peak RSS with `/usr/bin/time -v` on a long short.
      *Measured 2026-10-30: 3 min 1080×1920 export (272 MB) streamed in 0.56 s locally, peak RSS 60 MB (ffprobe
      included). Payload: `{ bucket: "exports", object: "<user>/<clip>/<task>.mp4", upload_url, content_type:
      "video/mp4" }`; output `{ bytes, content_type, duration, width, height }`. The web side presigns with its own
      key; the worker never holds a Zernio key.*
- [x] **B1 Zernio client**: profiles, connect link, accounts, presigned media, post, creator info (TikTok); typed
      errors with English messages for cards; idempotency key per slot; timeouts and one retry on 5xx. Fake first; the
      real API only after the owner gates.
      *Done against Zernio's OpenAPI (v1.420) with a fake `fetch`; no real call made. Real Zernio runs only with
      `ZERNIO_API_KEY` **and** `OPENCMO_PUBLISH_LIVE=1` (the key sits in prod `.env.local`). Owner (2026-10-30):
      real posting, the gates and review are next week's phase. Added `presignMedia` to the adapter for B3/B4.*
- [x] **B2 Connect routes**: `POST /api/v1/accounts/connect` → Zernio link (creates the founder's Zernio profile the
      first time through A's RPC), callback stores the account, `DELETE /api/v1/accounts/[id]` disconnects at Zernio
      then here; zod, rate limits, English errors.
      *`POST /api/v1/accounts/connect {platform}` → `{url}`; `GET /api/v1/accounts/callback` stores an account only
      when Zernio lists it under this founder's profile on that platform, then 303 → `/app/settings?tab=accounts`
      with `connected=<platform>` or `connect_error=<our sentence>`; `DELETE /api/v1/accounts/[id]` → `{disconnected}`.
      Rules in `lib/departments/publish/accounts.ts` (checked in `accounts.check.ts`).*
- [x] **B3 `publish_post` handler** *(wired by C after A and B stopped, `f7f61d0`: `lib/departments/publish/job.ts` over A2's RPCs, checked in `publish-post.check.ts`)*: reload the slot and its approval, check the snapshot hash again, start
      `publish_media` for a video and wait for its result, post through the adapter, call `publish_status`; no
      account → mark for the intent fallback card instead.
      *Rules done and checked (`lib/cmo/jobs/publish-post.ts`, `publish-post.check.ts`): `runPublishPost(deps, slotId)`
      re-entrant; waits on A2 for the deps (slot read, export, media task, `publish_status`). See the request in A.md.*
- [x] **B5 Webhook** *(route by C, `f7f61d0`: `app/api/webhooks/zernio/route.ts` + `webhook-handle.ts`, checked in `webhook.check.ts`)*: `/api/webhooks/zernio` verifies the signature, refuses replays through `zernio_receipts`, maps
      Zernio's status to `publish_status`; tests for a bad signature, a replay and each status.
      *Signature + event mapping done (`lib/departments/publish/webhook.ts`, `webhook.check.ts`); the route waits on
      A2's `publish_status` and a receipt RPC.*

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)

- [A → B] **B3 contract (A2, `20261230120000_p4_firing`).** The sweep's `schedule_claim_due()` makes one
  `publish_post` order and a CMO run with input `{slot_id, order_id, source: "event"}`. Your handler: call
  `publish_slot_start(slot_id)` (service role) right before posting; it refuses a slot that is not due, past its
  window, paused, changed since approval or without a connected account, marks it `publishing` and returns
  `{slot_id, user_id, deliverable_id, deliverable_kind, platform, zernio_account_id, idempotency_key, publish_at,
  text, title, clip_id, render_path, fields, attempt}`; `fields` is already in `PlatformFields` names (snake_case
  options are mapped in SQL). After `publish`, call `publish_status(slot_id, external_id, status, url, error)` with
  `accepted | published | failed` (`error` = `{code, message, retryable}`; a failure raises the Retry card). Export the
  job from a module A can import (e.g. `lib/departments/publish/job.ts` `publishPost(ctx)`); A then adds
  `JOBS.publish_post`, `CmoJobKind` and `CMO_JOB_KINDS` in one commit. SQL already allows the kind (free, 100 a day).
- [A → B] **B5:** `publish_status(null, zernio_post_id, …)` finds the slot by Zernio's post id; repeats are no-ops.
- [A → B] **B2:** the `accounts` bucket (30 per hour) is in `rate_limit_hit` (A2). Use `zernio_profile_save` and
  `social_account_save` (service role, after Zernio confirms the account is under the founder's profile) and
  `social_account_remove(id)` (the founder's session).
- [A → B] **B4:** push `publish_media_task.py` with its handler; A then adds `publish_media` to `tasks_kind_check` and
  `task-kinds.json` in one commit (the three must land together).
