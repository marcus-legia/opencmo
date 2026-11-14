# Session B: remove mode B (the founder's Claude as the brain)

Plan: [`../2026-11-14-remove-cmo-mcp-plan.md`](../2026-11-14-remove-cmo-mcp-plan.md) D2.
Rules: [`README.md`](README.md). **Starts after A has pushed.**

**Owns:**
- Engine: `apps/web/lib/cmo/brain.ts`, `brain.check.ts`, `schedule.ts`, `onboard.ts`; `lib/cmo/jobs/{think,runner,steps,
  store,memory-store,types,start,draft-post,draft-thread,edit-taxonomy,jobs.check}.ts`; `lib/cmo/writer/writer.check.ts`;
  `lib/agent/cmo-tools.ts` (`CmoTurn.brain` and the `p_brain` argument only).
- Routes: `apps/web/app/api/v1/cmo/mode/route.ts` (deleted), `app/api/v1/cmo/runs/route.ts`.
- UI: `components/editor/assistant/ContinueInClaude.tsx` (deleted), the lines that render it in `AssistantPanel.tsx`
  and `components/cmo/workspace/ChatPanel.tsx`; `components/today/AgentSales.tsx`;
  `components/screens/settings/SettingsScreen.tsx` (the "Who does the thinking" fieldset); `lib/screens/common.ts`
  and `load.ts` (`cmo.mode`), their fixtures, and the e2e specs that expect them.

**Do not touch** SQL (C). After B the web app stops sending `brain` and stops calling the `inbox_*` / `cmo_inbox_*`
RPCs; C drops them.

- [x] B1. **Decide in code what replaces mode B (D2).** `brain.ts` keeps only what the cron needs: is this founder
  able to pay for one model turn? Rename to something like `canThink(credits)`, or fold it into `schedule.ts`, and drop
  `forced` / `OPENCMO_BRAIN` and `llm_down`. A provider outage is not a reason to skip: the run takes the normal
  failover and `llm-error` path.
- [x] B2. `schedule.ts`: a founder without credits for a loop gets no run. Count it in `waiting` (as a paused account
  is) and drop the `inbox` counter from the result and from the cron route that logs it.
- [x] B3. `think.ts`: remove `NeedsClaude` and the `brain` parameter; `think()` always calls `structured()`.
- [x] B4. `runner.ts`: remove the inbox state, `memo`, `NOW_KEY` replay clock, `store.inbox` / `openInbox` /
  `finishInbox` calls and the `inbox` field of the result. Keep `Deferred`. Read the `RunContext` doc comments and
  remove what only the replay needed (`memo` keys).
- [x] B5. `store.ts` and `memory-store.ts`: remove `inbox`, `openInbox`, `finishInbox`, the `inbox_submit` simulation
  and the `{ claude }` option of `enqueueDueDrafts`. `steps.ts` (the inbox step table and `checkRubric`): delete it
  if nothing else imports it, otherwise keep only what the in-app jobs use.
- [x] B6. `types.ts`: remove `Brain` and `InboxRequest`. Fix every user: `draft-post.ts` and `draft-thread.ts` (the
  `ctx.brain === "claude"` branches go; the OpenCMO branch stays), `edit-taxonomy.ts` (`genModel` loses the
  `founder-claude` case), `start.ts` (kick when queued).
- [x] B7. `onboard.ts`: the first plan no longer gets `brain: "claude"`. `planDone` no longer needs the brain test.
- [x] B8. `cmo-tools.ts`: `CmoTurn` loses `brain`; the order call stops sending `p_brain` (the SQL default is null, so
  C can drop the parameter later without breaking this build); `startCmoRun` gets the input as it is. Fix the doc
  comment at line ~300.
- [x] B9. `app/api/v1/cmo/runs/route.ts`: remove the brain switch. A founder without credits gets the same
  "needs credits" answer the RPC already gives. Delete `app/api/v1/cmo/mode/route.ts`.
- [x] B10. UI: delete `ContinueInClaude.tsx` and its two `<ContinueInClaude … />` lines. `AgentSales.tsx` drops the
  `/cmo/mode` fetch and the three "Claude" labels (scan always shows its credit price). `SettingsScreen.tsx` drops the
  "Who does the thinking" fieldset; `lib/screens/common.ts` drops `cmo.mode`, `load.ts` drops the `brainMode` read.
  Update the settings fixture and any e2e that asserts the fieldset or the banner.
- [x] B11. Checks: `brain.check.ts` follows B1 (or is deleted with it); `jobs.check.ts` and `writer.check.ts` lose the
  `brain: "claude"` cases (lines ~574–660, ~257–300). Do not delete a case that also tests something else: rewrite it
  to the OpenCMO path.

## Gate

`cd apps/web && npm run typecheck && npm run check:contracts && npm run build`, and the e2e specs B touched.
`grep -rn 'brain: "claude"\|NeedsClaude\|brainMode\|cmo_inbox\|inbox_submit\|/cmo/mode' apps/web` returns nothing.
Verify by looking: open Settings and the editor Assistant on `npm run dev` with an account at 0 credits. No "Continue
in Claude" banner, no "Who does the thinking", and the CMO chat asks for credits.

## What I ran, what I could not

Done 2026-11-14 on `62c003b`.

- `apps/web`: `tsc --noEmit` passes; `npm run check:contracts` passes in full (exit 0); `npm run build` passes.
  `jobs.check`, `writer.check`, `schedule.check`, `screens.check`, `load.check`, `capabilities.check` run green on
  their own. `jobs.check` prints the same two stack traces as on `main` (deliberate store errors).
- `packages/mcp-server`: `npm run check` and `npm test` still pass (it imports `cmo-tools.ts`'s neighbours).
- The gate grep finds only the deliberate legacy case in `jobs.check.ts`.
- **Not run: the look at Settings and the Assistant on `npm run dev`.** This container has Docker but not the pinned
  Supabase CLI, so the dev stack does not start. The removed pieces are a banner, a fieldset and three labels; the
  build and `screens.check` (Settings fixture without `cmo.mode`) cover them. Someone should still open Settings once.
- Not run: the Playwright suites; no spec asserted the banner, the fieldset or `/cmo/mode` (grep), CI runs them.

How it was done, where it differs from the list:

- **B1/B2: `brain.ts` is deleted, not renamed.** The cron did not need it: `enqueue_cmo_run_for` already refuses a
  founder without credits ("Out of credits or at the daily cap: skip this run"), and `cmo_paid_users` already gates the
  loops. So a founder at 0 credits gets no model run, logged as skipped; no `waiting` count was added. `brainModes`,
  `decideBrain`, `providersUp`, `OPENCMO_BRAIN` and `brain.check.ts` are gone. `llm-health` stays: the failover uses it.
- **A bug found in B2:** `queued += await enqueueDueDrafts(…)` reads `queued` before the wait, so the eight parallel
  workers lost each other's counts (`schedule.check` caught it: 263 counted of 1199). The count is awaited first now.
- B3/B4: `think()` always asks the model (or the fake). The runner lost the inbox state, the memo, `NOW_KEY`,
  `ctx.once` and the `memo` option of `ctx.step`; `ctx.now` stays, read once per run. `RunOptions.think` is new: a
  stand-in for the model, so checks can read the request a job sends. `writer.check` used the inbox to read the
  Threads/X/core/LinkedIn prompts; it reads them through that hook now, with the same assertions.
- B5: `steps.ts` is deleted (only the inbox and one legacy check used it), and with it `RulesAnswerSchema` in
  `sales-scan.ts`, which only parsed old inbox answers. `toVerdict` and its check stay.
- B6: the `ctx.brain` branches go everywhere: `draft-post`, `draft-thread`, `writer/jobs` (`canFix`, caption pool),
  `sales-scan` (the shared subreddit-rules cache is always written; only OpenCMO's model writes it now), and
  `genModel` loses `founder-claude`.
- B7: onboarding ignores old runs with `input.brain = "claude"`. Those ended `done` in the inbox without writing a week,
  so a founder left with one now gets their first week instead of none.
- B9/B10 as listed. The `.cic` styles of the banner went from `globals.css`.
- `jobs.check` has one new case: a run queued before this change with `brain: "claude"` and an `inbox` id runs with
  OpenCMO, makes its card and records our model. That covers runs still in the queue at deploy time.
- Comments that described the inbox or "over MCP" were rewritten: `draft.ts`, `writer/jobs.ts`, `review-week.ts`,
  `onboard-status.ts`, `platforms.ts`, `site.ts`, `connect.ts`, `llm-health.ts`, `cmo-tools.ts`, `cmo-research.ts`.

Left for C: SQL still gives a `brain: "claude"` run on a paid plan 0 credits (`cmo_enqueue`). The web app no longer
sends `brain`, but a direct `enqueue_cmo_run` call still can, until C's migration.
