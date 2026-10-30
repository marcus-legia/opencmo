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
- [ ] **A1 Slots and cards**: `schedule_propose(deliverable_id)` (default slots from `schedule-defaults.json` loaded
      into a table by the migration, founder timezone, 3 h gap, X 5 a day, short vs its long video not the same
      day); raises a `schedule` card that expires at `publish_at`; `approval_decide` for `schedule`: approve → slot
      `waiting`; change time or account → supersede and raise a new card; cancel. pgTAP per transition, stale hash.
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
