# Session A: accounts, slots, schedule cards, firing

Plan: [`../2026-10-28-p4-schedule-publish-plan.md`](../2026-10-28-p4-schedule-publish-plan.md) · rules: [`README.md`](README.md).

## You own

- `supabase/migrations/20261230*`, `supabase/tests/` for them, `supabase/schema/current.sql`
- `packages/contracts/capabilities.json` (`publish_post`), the `publish_media` row in `task-kinds.json`
- `packages/contracts/schedule-defaults.json` (new: default slots per platform, from published studies)
- the `schedule_claim_due` call in `packages/engine/modal_app.py` `sweep()`
- `apps/web/lib/cmo/jobs/` runner dispatch for `publish_post`, event rules
- `apps/web/lib/screens/` (types, fixtures, loaders, registry), `apps/web/app/api/v1/screens/`, `apps/web/app/api/v1/approvals/`
- `docs/plans/cmo/2026-10-28-p4-acceptance/`

## Order

A0 → (push, M1) → A1 → A3 → A2 (after B0) → A4. Post "M1/M2/M3 ready for review" on the PR.

## Todo

- [x] **A0 Contracts (push first)**
  - [x] 1. Migration `20261230090000_p4_contracts` with grants, RLS read-own and pgTAP 215: `zernio_profiles`,
        `social_accounts` (unique per user + platform; Reddit refused), `schedule_slots` (§5 fields plus
        `idempotency_key`, `window_ends_at`, `lease_until`, `options`, `attempts`; one live slot per deliverable and
        platform), `zernio_receipts`, `approvals.ref_kind` `schedule_slot`. Account RPCs for B2:
        `zernio_profile_save` and `social_account_save` (service role only: a founder could otherwise name an account
        id that is not theirs) and `social_account_remove` (owner). `schedule_content()` gives what goes out and its
        hash. **`tasks_kind_check` gains `publish_media` in A2, together with its `task-kinds.json` row, once B4's
        handler exists:** the CHECK, the row and an importable handler must change together
        (`task-kinds.check.ts`, `test_task_kinds.py`, the worker's handler table).
  - [x] 2. `ScheduleSnapshotSchema` (field for field with SQL, checked in `screens.check.ts`),
        `ScheduleOptionsSchema` (TikTok privacy and toggles, AI-generated label), `SCHEDULE_ACTIONS`; the
        `approval_snapshot` case and `approval_raise` (department `schedule`, foot time and account, expires at
        `publish_at`).
  - [x] 3. Screen types: the `schedule` card body (slot, account, mode, timezone, preview, options, TikTok creator
        info, last error); `Account.avatarUrl`; fixtures. `schedule.*` and `settings.accounts` keep their shapes; the
        A3 loader maps SQL slot statuses onto the screen's.
- [x] **A1 Slots and cards** (`20261230100000_p4_slots`, pgTAP 216): `packages/contracts/schedule-defaults.json`
      (Buffer 2026 study, cited; `schedule_rules()` in SQL, `schedule-defaults.check.ts` compares them);
      `schedule_propose(deliverable)` (a post on its platform, a short on each platform with an approved caption;
      founder timezone, 3 h gap, daily caps, not the day of the short's long video, ±240 s jitter, 15 min window,
      at most 3 proposals per platform; no connected account → `intent`); `schedule_change` (time, account, platform
      fields; the slot asks again with a new card, even after approval; also for the calendar's drag);
      `approval_decide` `schedule`: approve / retry (TikTok needs privacy and the comment toggle; an intent slot on
      TikTok, Instagram or YouTube asks to connect; retry past the window proposes a new time), change → the new card,
      cancel. Failure cards expire with the window. Route actions `change_time`, `change_account`, `set_options`,
      `retry`; schedule cards build in `cards.ts` and are decidable.
- [ ] **A3 Loaders and rule**: event rule approved `post`/`short` deliverable → `schedule_propose`; loaders for
      `schedule.*` and `settings.accounts`; flip `live`; release gating.
- [ ] **A2 Firing**: `schedule_claim_due()` (service role; leases due `waiting` slots, marks past-window ones
      `missed` and raises a new card, skips everything while the brain is paused) → one `publish_post` work order per
      slot; `sweep()` calls it every minute; `publish_status(slot_id, status, external_id, url, error)` for B's
      handler and webhook; a failure raises a card whose Retry reuses the approval if `publish_at` is still in the
      window. pgTAP: lease, never twice, missed, paused, retry.
- [ ] **A4 Acceptance** on a local stack with the fake Zernio (F11), peak RSS of one `publish_media` run, screenshots
      at 1440 and 390 into `docs/plans/cmo/2026-10-28-p4-acceptance/`.

## Requests

(Others append `[from → A] what, why`; answer here with the commit.)

- [from B → A] Add `tsx lib/departments/publish/publish.check.ts && tsx lib/departments/publish/zernio.check.ts && tsx lib/departments/publish/accounts.check.ts` to `check:contracts` in `apps/web/package.json`
  (your block). Why: B0's adapter contract and fake (`lib/departments/publish/`) are checked there; it needs no
  `react-server` condition. No change asked to A0's snapshot: B3 maps `ScheduleSnapshot` (+ the slot's
  `idempotency_key` and the account's `zernio_account_id`) onto the adapter's `PublishDeliverable`/`PublishSlot`.
- [from B → A] B4's handler is importable: `opencmo.worker.publish_media_task:process` (for your A2 row in
  `task-kinds.json` and the `tasks_kind_check`). Payload `{ bucket: "exports", object: "<user>/<clip>/<task>.mp4",
  upload_url, content_type: "video/mp4" }`; the object must be the task owner's export. B3 queues it, so if the
  queuing RPC is yours, it needs those four fields (upload_url ≤ 2048 chars, https).

- **[from C → A] C1. Decide the schedule card.** `components/cards/decide.ts` sends, with `contentHash`: `approve`,
  `change_time {publish_at}` (UTC `YYYY-MM-DDTHH:MM:SSZ`), `set_options {options}` (`ScheduleOptionsSchema`),
  `retry`, `cancel {reason?}`. Please accept these in `/api/v1/approvals/[id]` and add `schedule` to
  `DECIDABLE_IN_WAVE_1` with A1; until then a live card shows its buttons disabled with the release reason.
- **[from C → A] C2. Fixtures for the states** in `SAMPLE_CARDS` (C4 and the look check open them at `/app/inbox/[id]`):
  `card-time-failed` (`problem {kind: "failed", text}` and `lastError`), `card-time-missed` (`lastError`, no
  problem, a new `at`), `card-time-intent` (LinkedIn, `mode: "intent"`, `accountId: null`, `tiktok: null`),
  `card-time-choose` (TikTok with `options.privacy` unset), `card-time-youtube` (a title, `ai_label`).
- **[from C → A] C3. TikTok's posting guidelines** (needed for Zernio's/TikTok's audit): the founder picks the audience,
  so `schedule_propose` leaves `options.privacy` unset and `allow_comment`/`allow_duet`/`allow_stitch` false; the card
  blocks Approve until a privacy level is saved, and `approval_decide` should refuse `approve` on a TikTok `publish`
  slot without one. The card shows TikTok's Music Usage Confirmation line. TikTok also asks for a commercial content
  disclosure ("your brand" / "branded content"): when you add it to `ScheduleOptionsSchema`
  (`brand_organic`, `brand_content`), tell me and I render the toggles. B's `CreatorInfo` also has `canPostMore` (TikTok's daily
  limit) and `maxVideoSeconds`: please carry both into the body's `tiktok` so the card can say "TikTok's daily limit is
  reached: pick another day" instead of offering Approve.
- **[from C → A] C4. Published link.** C0 shows "published (link)" only if the body carries it: please add
  `publishedUrl: z.url().nullable()` to the schedule body (A3 loader from `schedule_slots`), or say where it lives.
- **[from C → A] C5. How states map** (what C0 reads): a failed post → card with `problem.kind = "failed"` (Retry, Change
  time, Cancel stay enabled); a missed slot → new card with `lastError` and no problem ("Approve new time").
- **[from C → A] C6. Foot line.** The body already shows the account, the time and the why; the fixture's `meta` repeats
  the why. Keep `meta` empty (or credits) on schedule cards.
