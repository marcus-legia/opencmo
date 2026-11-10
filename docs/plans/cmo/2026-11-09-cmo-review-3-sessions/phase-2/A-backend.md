# Session A: backend (I0, and the RPCs for I1 and I2)

> **Phase 2, not started.** Kept from the first draft of the plan (2026-11-09). It starts after phase 1 is reviewed, and
> the reviewer re-checks it against `main` first. Links to the plan point to its §8. I2 (the prompter) is already on `main`.

Plan: [`../../2026-11-09-cmo-review-3-plan.md`](../../2026-11-09-cmo-review-3-plan.md) §8.

**Owns:**
- `supabase/migrations/*`, from `20270113010000`;
- `supabase/tests/*`;
- `supabase/schema/current.sql`;
- `apps/web/lib/agent/cmo-tools.ts`;
- `apps/web/lib/cmo/jobs/eval/**`;
- `apps/web/lib/cmo/script.ts` (new).

**Waits on:** nothing. B and C wait on A1.

## Todo, in order

- [ ] **A1 Shared script helpers (first, push at once).**
  - Write `lib/cmo/script.ts` with these types: `Script` (order id, title, hooks, beats, status, clip id, version).
  - Write these helpers:
    - `scriptForClip(supabase, clipId)`;
    - `scriptForOrder(supabase, orderId)`;
    - `editBeat(supabase, orderId, beat, { say?, show? }, version)`.
  - Add the RPCs they call:
    - `cmo_script_for_clip(p_clip)` and `cmo_script_read(p_order)`: owner-checked reads of `work_orders.brief`
      (storyboard, hooks, `clip_id`);
    - `cmo_script_edit_beat(p_order, p_beat, p_say, p_show, p_version)`: limits from `ScriptBeatSchema` (300
      characters), a version check, and an `edited` event on the order. The approval snapshot is not touched.
  - pgTAP:
    - another user's order: not found;
    - a stale version: refused;
    - an edit: changes the beat and only that beat.
- [ ] **A2 I0: the CMO chat orders a script.**
  - Add the `cmo_order_script(p_brief, p_day, p_platform)` RPC. In one transaction it creates:
    - the calendar item;
    - the `write_video_brief` order, as `work_orders_plan_week` makes it for a video item (C1);
    - the credit hold.
  - In `cmo-tools.ts`:
    - agent `video` calls `cmo_order_script` behind the chat's price card;
    - the old `cmo_add_item` path stays only for "remind me to post a video I have";
    - the tool's description and the `create_task` error string change with it.
  - pgTAP:
    - one order, one item, one hold;
    - no `build_video`.
- [ ] **A3 CMO eval cases.**
  - Case 1: a strategy that calls for a demo video gives a plan with one script item and a storyboard (C1's open
    item).
  - Case 2: "write me a script for a 30 s demo" in the chat gives one `create_task` with agent `video`, and no
    `build_video`.
- [ ] **A4 Schema dump and checks.**
  - Regenerate the schema with `scripts/dump-schema.sh`.
  - Run pgTAP on a reset database, `npm run typecheck` and `check:contracts`.

## Research note

(Write before A1: what the code does now with `file:line`, what changes, how it is checked.)

## Requests

(Other sessions write their requests here.)
