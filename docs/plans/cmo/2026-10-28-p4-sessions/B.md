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
- [ ] **B3 `publish_post` handler**: reload the slot and its approval, check the snapshot hash again, start
      `publish_media` for a video and wait for its result, post through the adapter, call `publish_status`; no
      account → mark for the intent fallback card instead.
      *Rules done and checked (`lib/cmo/jobs/publish-post.ts`, `publish-post.check.ts`): `runPublishPost(deps, slotId)`
      re-entrant; waits on A2 for the deps (slot read, export, media task, `publish_status`). See the request in A.md.*
- [ ] **B5 Webhook**: `/api/webhooks/zernio` verifies the signature, refuses replays through `zernio_receipts`, maps
      Zernio's status to `publish_status`; tests for a bad signature, a replay and each status.
      *Signature + event mapping done (`lib/departments/publish/webhook.ts`, `webhook.check.ts`); the route waits on
      A2's `publish_status` and a receipt RPC.*

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)
