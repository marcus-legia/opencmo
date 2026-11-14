# Session C: drop the inbox from the database; docs

Plan: [`../2026-11-14-remove-cmo-mcp-plan.md`](../2026-11-14-remove-cmo-mcp-plan.md) D3.
Rules: [`README.md`](README.md). **Starts after B has pushed.** Read `.claude/skills/supabase-migrations` first.

**Owns:** `supabase/migrations/<next timestamp>_remove_cmo_inbox.sql`,
`supabase/tests/<next number>_remove_cmo_inbox.test.sql`, the changed cases of `158`, `159`, `176`, `182`, `239`,
`240`, `272`; `supabase/schema/current.sql`; `docs/architecture/{brain,approval,workflow,ai-cmo,studio}.{md,html}`
(change each `.md` and its `.html` together); `docs/plans/cmo/README.md`; `apps/web/.env.example`;
`apps/web/lib/ops/switches.ts` (text only); `CLAUDE.md`, if it names the CMO MCP tools.

- [x] C1. Before writing the migration, check the live state the migration meets: open `cmo_inbox` rows have their
  `cmo_runs` in `done` with `output.waiting_for`, and no `credit_held` row points at them (`ref_kind = 'cmo_run'`).
  Write the query and its expected result in the migration header. If held credits can exist, the migration refunds
  them through `credit_refund` before the drop.
- [x] C2. Migration, starting from the latest definition of each function in `supabase/schema/current.sql`:
  - `drop function` `inbox_submit`, `inbox_claim`, `inbox_list`, `cmo_inbox_finish`, `cmo_inbox_open`,
    `cmo_inbox_max_rounds`; `drop table public.cmo_inbox`.
  - `cmo_enqueue` (every enqueue goes through it, `enqueue_cmo_run` included): always `p_input := p_input - 'brain' -
    'inbox'`, so no input reaches the 0-credit branch, then remove that branch and the `brain` term of the dedupe test. **This is the money line**: a paid founder must never get a free run
    from a client that still sends `brain`.
  - `cmo_first_draft_after_plan`: drop the `brain` test.
  - `cmo_order_script`: drop `p_brain`. Create the new signature and drop the old one, and keep the grants the old one
    had (B already stopped sending it).
  - `cmo_read_limit` / `cmo_read_hit`: remove `mcp_social` and `mcp_site`. Keep `research_credits` and any other bucket.
- [x] C3. pgTAP. Retire `158_cmo_inbox` and `159_cmo_inbox_read_caps`: delete them and say so in the PR. Their
  objects no longer exist. In `176`, `240`, `272`, replace the `brain: claude` cases with "a `brain` key is ignored and
  the run is charged". In `239`, drop the `mcp_social` line. In `182`, drop the three inbox functions and update the
  `cmo_order_script` signature. Add a new test file: the dropped objects are gone, `enqueue_cmo_run('post_draft',
  '{"brain":"claude"}')` holds the normal price on a paid plan, `cmo_read_hit('mcp_social')` is refused.
- [x] C4. `scripts/dump-schema.sh`. The diff of `current.sql` holds only this migration's change.
- [x] C5. Docs. In `docs/architecture/`, remove mode B, the Claude inbox and the "who thinks" switch, and say what
  happens at 0 credits (D2). Add the plan to the `docs/plans/cmo/README.md` table. `.env.example`: drop
  `OPENCMO_BRAIN` and rewrite the `OPENCMO_MCP_URL` note ("unset hides Connect Claude" → the editor MCP).
  `lib/ops/switches.ts`: the MCP switch text names the editor MCP.
- [x] C6. Final sweep: `grep -rn "cmo_inbox\|inbox_submit\|inbox_claim\|mcp_social\|mcp_site\|OPENCMO_BRAIN\|Continue in Claude\|list_inbox"`
  in `apps packages supabase/tests docs/architecture` returns nothing outside applied migrations and dated plans.

## Gate

`npm run db:reset && npm run db:test` with the pinned CLI (CLAUDE.md, "Running"). If the CLI cannot start, run pgTAP
in the `supabase/postgres` image as earlier sessions did, and say which files failed before and after.
`cd apps/web && npm run typecheck && npm run check:contracts`.

## What I ran, what I could not

Done 2026-11-14 on `c7e9f6c`. Migration `20270124010000_remove_cmo_inbox.sql`, test `316_remove_cmo_inbox.test.sql`.

- The Supabase CLI is not in this container. pgTAP ran against `supabase/postgres:17.6.1.054` in Docker, as the skill
  describes: the image's minimal `storage` tables got the columns the migrations use, `auth.uid()` / `auth.role()` /
  `auth.jwt()` read `request.jwt.claims` as GoTrue's do, and `auth.users` got `deleted_at`, `is_anonymous`, `phone`,
  `banned_until`. Every migration applied in order (`psql -1 -v ON_ERROR_STOP=1`).
- **With the change: 207 of 207 test files pass**, `316` 16/16.
- **Without it** (a second container with every migration but the new one): `316` fails (1–7 …), `176` fails 4 and 7,
  `272` fails 4, `290` and `182` fail on the new signature, so each changed case tests the change. The retired `158`
  and `159`, and the old `176` and `290`, pass on the old schema.
- `supabase/schema/current.sql`: the baseline container's dump (same pipeline as `scripts/dump-schema.sh`) equals the
  committed file line for line; the new dump's diff is only this migration (the inbox table, its six functions and
  policy go; `cmo_enqueue`, `cmo_first_draft_after_plan`, `cmo_order_script`, `cmo_read_limit`, `cmo_read_hit`
  change; `cmo_fail_claude_runs` is new).
- `apps/web`: `tsc --noEmit` passes; `switches.check` passes. CI's `database (Supabase)` job is the authoritative run.

How it was done, where it differs from the list:

- **C1: no credit is held for inbox work**, so nothing is refunded. A paid founder's `brain = 'claude'` run was
  priced 0, a free founder's lost the key in `cmo_enqueue`, replays were inserted with `credits = 0`, and a run that
  opened an inbox item ended `done` through `complete_cmo_run`. The migration header has the check query for the push
  (expected 0 rows).
- **Beyond the list: runs still queued for the founder's Claude fail.** They hold 0 credits; after B the web app would
  run them with OpenCMO's model for free. `cmo_fail_claude_runs()` (service role only, called once by the migration)
  fails each through `complete_cmo_run`, so its refund and work-order triggers run as for any failure, with the
  sentence "This task was waiting for your own Claude, which OpenCMO no longer uses. Ask for it again." Running ones
  finish as they are.
- C2: `cmo_enqueue` strips `brain` and `inbox` from every input instead of refusing `inbox`, so an old client
  pays like anyone. The daily limit counts every run (it skipped replays). `cmo_first_draft_after_plan` skips a plan
  whose output has `waiting_for` (one that ended in the old inbox wrote no week) instead of testing `brain`.
- C3: `290_cmo_order_script` also changed (the new signature, the `p_brain` case gone). `272`'s inbox case now
  seeds a plan that ended with `waiting_for`.
- C5: `docs/architecture/brain`, `approval` and `ai-cmo` (each `.md` with its `.html`); `workflow` and `studio` only
  name the editor's MCP, which stays. `OPENCMO_BRAIN` was never in `.env.example`. The leftover `.cic` rule in
  `apps/web/styles/cmo.css` went too. `CLAUDE.md` names no CMO MCP tool, so it is unchanged.
