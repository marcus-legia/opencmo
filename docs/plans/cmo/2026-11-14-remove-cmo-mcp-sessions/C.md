# Session C: drop the inbox from the database; docs

Plan: [`../2026-11-14-remove-cmo-mcp-plan.md`](../2026-11-14-remove-cmo-mcp-plan.md) D3.
Rules: [`README.md`](README.md). **Starts after B has pushed.** Read `.claude/skills/supabase-migrations` first.

**Owns:** `supabase/migrations/<next timestamp>_remove_cmo_inbox.sql`,
`supabase/tests/<next number>_remove_cmo_inbox.test.sql`, the changed cases of `158`, `159`, `176`, `182`, `239`,
`240`, `272`; `supabase/schema/current.sql`; `docs/architecture/{brain,approval,workflow,ai-cmo,studio}.{md,html}`
(change each `.md` and its `.html` together); `docs/plans/cmo/README.md`; `apps/web/.env.example`;
`apps/web/lib/ops/switches.ts` (text only); `CLAUDE.md`, if it names the CMO MCP tools.

- [ ] C1. Before writing the migration, check the live state the migration meets: open `cmo_inbox` rows have their
  `cmo_runs` in `done` with `output.waiting_for`, and no `credit_held` row points at them (`ref_kind = 'cmo_run'`).
  Write the query and its expected result in the migration header. If held credits can exist, the migration refunds
  them through `credit_refund` before the drop.
- [ ] C2. Migration, starting from the latest definition of each function in `supabase/schema/current.sql`:
  - `drop function` `inbox_submit`, `inbox_claim`, `inbox_list`, `cmo_inbox_finish`, `cmo_inbox_open`,
    `cmo_inbox_max_rounds`; `drop table public.cmo_inbox`.
  - `cmo_enqueue` (every enqueue goes through it, `enqueue_cmo_run` included): always `p_input := p_input - 'brain' -
    'inbox'`, so no input reaches the 0-credit branch, then remove that branch and the `brain` term of the dedupe test. **This is the money line**: a paid founder must never get a free run
    from a client that still sends `brain`.
  - `cmo_first_draft_after_plan`: drop the `brain` test.
  - `cmo_order_script`: drop `p_brain`. Create the new signature and drop the old one, and keep the grants the old one
    had (B already stopped sending it).
  - `cmo_read_limit` / `cmo_read_hit`: remove `mcp_social` and `mcp_site`. Keep `research_credits` and any other bucket.
- [ ] C3. pgTAP. Retire `158_cmo_inbox` and `159_cmo_inbox_read_caps`: delete them and say so in the PR. Their
  objects no longer exist. In `176`, `240`, `272`, replace the `brain: claude` cases with "a `brain` key is ignored and
  the run is charged". In `239`, drop the `mcp_social` line. In `182`, drop the three inbox functions and update the
  `cmo_order_script` signature. Add a new test file: the dropped objects are gone, `enqueue_cmo_run('post_draft',
  '{"brain":"claude"}')` holds the normal price on a paid plan, `cmo_read_hit('mcp_social')` is refused.
- [ ] C4. `scripts/dump-schema.sh`. The diff of `current.sql` holds only this migration's change.
- [ ] C5. Docs. In `docs/architecture/`, remove mode B, the Claude inbox and the "who thinks" switch, and say what
  happens at 0 credits (D2). Add the plan to the `docs/plans/cmo/README.md` table. `.env.example`: drop
  `OPENCMO_BRAIN` and rewrite the `OPENCMO_MCP_URL` note ("unset hides Connect Claude" → the editor MCP).
  `lib/ops/switches.ts`: the MCP switch text names the editor MCP.
- [ ] C6. Final sweep: `grep -rn "cmo_inbox\|inbox_submit\|inbox_claim\|mcp_social\|mcp_site\|OPENCMO_BRAIN\|Continue in Claude\|list_inbox"`
  in `apps packages supabase/tests docs/architecture` returns nothing outside applied migrations and dated plans.

## Gate

`npm run db:reset && npm run db:test` with the pinned CLI (CLAUDE.md, "Running"). If the CLI cannot start, run pgTAP
in the `supabase/postgres` image as earlier sessions did, and say which files failed before and after.
`cd apps/web && npm run typecheck && npm run check:contracts`.

## What I ran, what I could not

(filled in by the session)
