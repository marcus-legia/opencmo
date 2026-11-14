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

- [ ] B1. **Decide in code what replaces mode B (D2).** `brain.ts` keeps only what the cron needs: is this founder
  able to pay for one model turn? Rename to something like `canThink(credits)`, or fold it into `schedule.ts`, and drop
  `forced` / `OPENCMO_BRAIN` and `llm_down`. A provider outage is not a reason to skip: the run takes the normal
  failover and `llm-error` path.
- [ ] B2. `schedule.ts`: a founder without credits for a loop gets no run. Count it in `waiting` (as a paused account
  is) and drop the `inbox` counter from the result and from the cron route that logs it.
- [ ] B3. `think.ts`: remove `NeedsClaude` and the `brain` parameter; `think()` always calls `structured()`.
- [ ] B4. `runner.ts`: remove the inbox state, `memo`, `NOW_KEY` replay clock, `store.inbox` / `openInbox` /
  `finishInbox` calls and the `inbox` field of the result. Keep `Deferred`. Read the `RunContext` doc comments and
  remove what only the replay needed (`memo` keys).
- [ ] B5. `store.ts` and `memory-store.ts`: remove `inbox`, `openInbox`, `finishInbox`, the `inbox_submit` simulation
  and the `{ claude }` option of `enqueueDueDrafts`. `steps.ts` (the inbox step table and `checkRubric`): delete it
  if nothing else imports it, otherwise keep only what the in-app jobs use.
- [ ] B6. `types.ts`: remove `Brain` and `InboxRequest`. Fix every user: `draft-post.ts` and `draft-thread.ts` (the
  `ctx.brain === "claude"` branches go; the OpenCMO branch stays), `edit-taxonomy.ts` (`genModel` loses the
  `founder-claude` case), `start.ts` (kick when queued).
- [ ] B7. `onboard.ts`: the first plan no longer gets `brain: "claude"`. `planDone` no longer needs the brain test.
- [ ] B8. `cmo-tools.ts`: `CmoTurn` loses `brain`; the order call stops sending `p_brain` (the SQL default is null, so
  C can drop the parameter later without breaking this build); `startCmoRun` gets the input as it is. Fix the doc
  comment at line ~300.
- [ ] B9. `app/api/v1/cmo/runs/route.ts`: remove the brain switch. A founder without credits gets the same
  "needs credits" answer the RPC already gives. Delete `app/api/v1/cmo/mode/route.ts`.
- [ ] B10. UI: delete `ContinueInClaude.tsx` and its two `<ContinueInClaude … />` lines. `AgentSales.tsx` drops the
  `/cmo/mode` fetch and the three "Claude" labels (scan always shows its credit price). `SettingsScreen.tsx` drops the
  "Who does the thinking" fieldset; `lib/screens/common.ts` drops `cmo.mode`, `load.ts` drops the `brainMode` read.
  Update the settings fixture and any e2e that asserts the fieldset or the banner.
- [ ] B11. Checks: `brain.check.ts` follows B1 (or is deleted with it); `jobs.check.ts` and `writer.check.ts` lose the
  `brain: "claude"` cases (lines ~574–660, ~257–300). Do not delete a case that also tests something else: rewrite it
  to the OpenCMO path.

## Gate

`cd apps/web && npm run typecheck && npm run check:contracts && npm run build`, and the e2e specs B touched.
`grep -rn 'brain: "claude"\|NeedsClaude\|brainMode\|cmo_inbox\|inbox_submit\|/cmo/mode' apps/web` returns nothing.
Verify by looking: open Settings and the editor Assistant on `npm run dev` with an account at 0 credits. No "Continue
in Claude" banner, no "Who does the thinking", and the CMO chat asks for credits.

## What I ran, what I could not

(filled in by the session)
