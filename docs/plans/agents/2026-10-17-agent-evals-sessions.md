# Agent evals: work split for three sessions, one PR

Plan: [`2026-10-17-agent-evals-plan.md`](2026-10-17-agent-evals-plan.md) — read it first, all of it.
Branch: **`plan/agents/2026-10-17-agent-evals`** · PR: [#72](https://github.com/marcus-legia/opencmo/pull/72) (draft), shared by all three sessions.

Three Claude Code sessions build this in parallel on the same branch:

- **Session A — Production signal**: where drafts came from, `cmo_draft_outcomes`, the edit taxonomy,
  `classify_edits`, the price fix, the Reddit seam.
- **Session B — Harness**: the report format and paired comparison, the cascade judge, the `cmo:eval` case registry
  and fixtures, `agent:eval` reports, CI and the scheduled eval workflow.
- **Session C — Coverage**: onboarding, Sales and CMO chat memory-safety cases; trajectory rules for the editor eval.

## Rules for all sessions

1. **Own your paths.** Edit only the paths listed for your session. Need a change in another session's paths? Write
   it under "Requests" below and let them make it.
2. **Same branch, no force.** `git pull --rebase origin plan/agents/2026-10-17-agent-evals` before every push; never
   `--force`; never rebase pushed commits; never push to `main`.
3. **Small commits, prefixed** `[A]`, `[B]` or `[C]`, English messages, each one green on its own (typecheck + the
   tests of what it touches). End with the attribution lines your tooling gives you.
4. **Update your checklist** in this file in the same commit that finishes an item (only your own section).
5. **Repo rules still apply** (CLAUDE.md): every write through an ownership-checking RPC; money only through the
   credit module (classifier and judge costs are internal, never charged); every migration has a pgTAP test and is
   followed by `scripts/dump-schema.sh`; English everywhere, including SQL `raise exception` text and comments you
   touch (translate Vietnamese comments in lines you edit); comments explain why. Licences: inbox-zero is AGPL —
   learn only; inspect_ai / promptfoo / autoevals / agentevals are MIT — learn, write our own.
6. **Heavy suites one at a time** (`db:reset`/`db:test`, `npm run build`, real-model evals).
7. **Do not deploy.** Marcus runs `db push` and merges after review.
8. **Real-model runs cost money.** Only with `--yes`, only once per item that asks for it, cost noted here.

## Shared contracts

Land these first; others code against them and they change only through a "Requests" note.

```ts
// A1 — apps/web/lib/cmo/jobs/edit-taxonomy.ts
export const EDIT_MODES = ["NO_MEANINGFUL_EDIT", "TOO_SALESY", "WRONG_VOICE", "INVENTED_CLAIM",
  "TOO_LONG", "HOOK_REWRITTEN", "CTA_REMOVED", "FULL_REWRITE"] as const;
export type EditMode = (typeof EDIT_MODES)[number];
export const EDIT_MODE_TEXT: Record<EditMode, string>;
export type DraftGen = { model: string; prompt_version: string };

// A1 — apps/web/lib/cmo/jobs/runner.ts (A owns these lines)
export type JobContext = { /* … */ searchReddit?: (query: string) => Promise<RedditThread[]> };
// drainCmoQueue(store, { runId, budgetMs, searchReddit? })

// B1 — apps/web/lib/eval/compare.ts
export type CaseResult = { id: string; epoch: number; pass: boolean | null; decided_by: "code" | "judge" | "error";
  verdict?: string; notes?: string[]; cost_usd?: number; pending?: string /* why it cannot pass yet */ };
export type EvalReport = { suite: "cmo" | "agent"; git: { head: string; diffHash: string | null }; provider: string;
  model: string | null; prompt_versions: Record<string, string>; started_at: string; cases: CaseResult[] };

// B1 — apps/web/lib/cmo/jobs/eval/types.ts
export type EvalFixture = { name: string; docs: Documents; brief: string; clips: ClipInfo[] };
export type EvalCase = { job: string; once?: boolean /* brings its own fixtures: run once per epoch */;
  run(fixture: EvalFixture, env: EvalEnv): Promise<CaseResult[]> };
export type EvalEnv = { drain: typeof drainCmoQueue; provider: string; judge: Judge; epoch: number;
  log: (line: string) => void /* printed under the table on real runs */ };
export function registerCases(cases: EvalCase[]): void;
// Every file in eval/cases/ is imported by the runner (sorted); it calls registerCases at import time.

// B1 — apps/web/lib/cmo/jobs/judge.ts
export type Judge = (input: { job: string; docs: Documents; output: string; criteria?: string[] })
  => Promise<{ pass: boolean | null; verdict?: string; reasons?: string; cost_usd?: number }>;
export function fakeJudge(): Judge;                       // fixed labels, same path as the model judge
export function cascade(id: string, epoch: number, issues: string[], judge: Judge | null, input: JudgeInput)
  => Promise<CaseResult>;                                 // code issues decide alone; judge failure → pass: null
```

## Session A — Production signal

**Owns:** `supabase/**`, `apps/web/lib/cmo/jobs/{draft-post,sales-scan,runner,edit-taxonomy,classify-edits}.ts`,
`apps/web/lib/cmo/jobs/jobs.check.ts`, `apps/web/app/api/cron/cmo/**`, the `PRICES` constant in
`apps/web/lib/agent/eval/run.ts` (one-line change; tell B in "Requests" before pushing it).

- [x] **A1 — Contracts.** `edit-taxonomy.ts` (`EDIT_MODES`, `EDIT_MODE_TEXT`, `DraftGen`, `promptVersion()`);
      `JobContext.searchReddit` + `drainCmoQueue` option, `sales-scan.ts` uses `ctx.searchReddit ?? searchReddit`.
      Accept: typecheck; `jobs.check.ts` green; a test that a W4 run with an injected search sees only the injected
      threads. Push this first.
      _Done:_ also `genModel(answered, brain, fake)` in `edit-taxonomy.ts` (`founder-claude` for inbox runs, `fake`
      in fake mode). The option travels `drainCmoQueue(store, { searchReddit })` → `runOne(store, run, opts)` →
      `ctx.searchReddit`; production callers pass nothing.
- [x] **A2 — Where drafts came from (P1).** `body.gen` in `draft-post.ts` (model that answered, after failover);
      `opportunities.gen` column + `cmo_save_opportunities` passes `p_items[].gen`; `sales-scan.ts` sets it.
      Accept: `jobs.check.ts` asserts `gen` on fake runs; pgTAP for the column.
      _Done:_ the model comes from `onUsage` of the call whose text the founder sees (`fix_post` when it ran, else
      `draft_post`; `draft_reply` for Sales). `prompt_version` hashes the writer's system prompt (`SYSTEM`,
      `REPLY_SYSTEM`), skill text included. Migration `20261201090000_cmo_draft_gen.sql`: `opportunities.gen` keeps
      only `model` (≤ 100) and `prompt_version` (≤ 40), ≤ 256 bytes; pgTAP `162_cmo_draft_gen`.
- [x] **A3 — `cmo_draft_outcomes` (P2).** Migration: `pg_trgm` in `extensions`, table + RLS + revokes, new
      `cmo_decide_post` / `cmo_decide_opportunity` bodies writing the outcome in the same transaction, view
      `cmo_draft_quality_weekly` (service role only), `EDIT_MODES` check constraint. `dump-schema.sh`.
      Accept: pgTAP — other user cannot read; user cannot insert/update; approve as written → similarity 1 and
      right `chosen_version`; approve an alternate edited → < 1 and the nearest version; skip → null similarity;
      opportunity replied / dismissed → row; `authenticated` cannot select the view. `db:reset && db:test` green.
      _Done:_ `20261201100000_cmo_draft_outcomes.sql`, pgTAP `163_cmo_draft_outcomes` (25 checks). Approvals at
      similarity ≥ 0.95 (`cmo_as_written()`) are labelled `NO_MEANINGFUL_EDIT` at once, so the classifier only sees
      real edits. No text is copied into the table. Ran on this container's Postgres 16 with pgTAP and a stand-in
      for the Supabase `auth`/`storage` schemas (Docker image pulls are blocked here): all 96 pgTAP files pass.
      `current.sql` updated from the before/after diff of a dump, not a fresh dump (the file comes from Postgres 17);
      worth one `scripts/dump-schema.sh` on a machine with Supabase local.
- [ ] **A4 — `classify_edits` (P3/P4).** Service-role RPCs `cmo_claim_unclassified_outcomes(p_limit)` /
      `cmo_set_edit_mode(p_id, p_mode)`; `classify-edits.ts` with `checker` and a fake rule; called from the cron
      route with a small cap; a check test that `EDIT_MODES` equals the SQL constraint list.
      Accept: `jobs.check.ts` (fake labels, cap respected, nothing charged); pgTAP for the RPC grants.
- [x] **A5 — Prices (P5).** Migration `cache_read = 0.1` for `claude-sonnet-5%` + pgTAP; `PRICES.anthropic` in
      `run.ts`. Accept: `db:test`; typecheck.
      _Done:_ `20261201110000_sonnet_cache_price.sql` + pgTAP `164_sonnet_cache_price` (a million cache-read
      tokens = 100 000 micro-USD). `PRICES.anthropic` in `run.ts` → Sonnet 5.5 ($2 / $10 / $0.10 / $2.50), matching
      B's `lib/eval/prices.ts`. Data only, so `current.sql` does not change.

## Session B — Harness

**Owns:** `apps/web/lib/eval/**`, `apps/web/lib/cmo/jobs/{eval,judge}.ts`,
`apps/web/lib/cmo/jobs/eval/{types,runner,fixtures,core}.ts` (+ their `.check.ts`), `apps/web/lib/agent/eval/run.ts` (except A's `PRICES`
line), `apps/web/package.json` scripts, `.github/workflows/**`, `docs/cmo-architecture-implementation.md`.

- [x] **B1 — Contracts.** `compare.ts` types; `eval/types.ts` with `registerCases`; `Judge` type and a fake judge.
      Accept: typecheck. Push this first.
- [x] **B2 — Compare (H1).** `mcnemarExact`, `compareReports`, `kOfK`, `cohensKappa` + `compare.check.ts`.
      Accept: known (b, c) → known p; identical reports → `INCONCLUSIVE`, p = 1; kappa of identical labels = 1.
- [x] **B3 — Cascade judge (H2).** `judge.ts` per the plan: code tier first, `checker` on the other provider,
      labels with reasons first, binary criteria one at a time, failures → `pass: null`.
      Accept: unit test with a stub `structured` — code failure never calls the judge; thrown error and unknown
      label → unscored; fake provider returns fixed labels.
- [x] **B4 — `cmo:eval` registry (H3).** Move W1/W2/W5 into the registry without changing what they check; 3–5 new
      fixtures; `--epochs`, `--out`, `--compare`, `--max-usd` / `EVAL_MAX_USD`; report JSON; `pending` cases listed
      apart and never fail the run. Accept: `cmo:eval -- --provider fake` green and writes the report; same rows
      as `main` for W1/W2/W5 on the old three fixtures.
      _Done:_ W1/W2/W5 live in `eval/core.ts`; the CLI also imports every file in `eval/cases/` (sorted), so C only
      adds files there. Fixtures: the old three + `meals` (B2C), `changelog` (distinctive voice), `pottery` (no
      numbers to borrow). Each case returns `${job}:${fixture}:run` first, then one result per output (W1 per plan
      item, W2 per version — judged after `checkPost` —, W5 per clip). `--provider gemini` sets
      `CMO_LLM_PROVIDER`. Fake run: 18 runs, 63/63 outputs pass; same rows as `main` on the old fixtures.
- [x] **B5 — `agent:eval` reports (H4).** Same `EvalReport`, `--epochs`, `--compare`. Accept:
      `agent:eval -- --provider fake` result unchanged; report written; `--compare` of two fake runs → INCONCLUSIVE.
      _Done:_ `eval-report.json` next to `report.json` (case id = task id, `prompt_versions.assistant`), plus
      `--max-usd`. Fake result unchanged: 41/43 before and after; the two failures (`explain-make`,
      `explain-vaccine`) need the explainer renderer (`OPENCMO_MOTION=local` + Chrome), see B6. Two full fake runs
      compared → INCONCLUSIVE, 43 paired, p = 1.
- [ ] **B6 — CI + scheduled evals (H5, after C1–C3 are pushed).** Fake runs in `ci.yml`; `ai-evals.yml` with
      dispatch + weekly cron, cost cap, artifact upload, compare to previous artifact, actions pinned to SHAs.
      Replace "judge the drafts by eye" in `docs/cmo-architecture-implementation.md`. Accept: CI green on the PR;
      one manual dispatch (fake provider) run attached; real-provider run noted with cost if a key is set.
      _Pushed:_ `ci.yml` motion job runs `agent:eval -- --provider fake` with `OPENCMO_MOTION=local` (its explainer
      tasks need the clip-motion CLI and that job's Chrome); the CMO fake eval already runs in `check:contracts` and
      loads every file in `eval/cases/`, so C's cases are covered as they land. `ai-evals.yml`: dispatch (suite,
      job, provider, epochs, max_usd) + Monday 06:17 UTC on anthropic and gemini (W1, W2, W4, W0 — the ones
      registered), `EVAL_MAX_USD` default $3, report uploaded as `eval-<suite>-<provider>` and compared with the
      newest earlier artifact of that name; keys only in the `ai-evals` environment; actionlint clean. GitHub only
      dispatches workflows that exist on `main`, so the manual run waits for the merge.

## Session C — Coverage

**Owns:** `apps/web/lib/cmo/jobs/eval/cases/**`, `apps/web/lib/cmo/jobs/eval/fixtures/{sites,reddit}/**`,
`apps/web/lib/agent/eval/{tasks,cmo-tasks,cmo-run,trajectory}.ts`, `apps/web/lib/agent/providers/fake.ts` (fake
scripts only).

Until A1/B1 land, code against the contracts above with local stubs; delete the stubs when they land.

- [x] **C1 — Onboarding (C1).** 4–6 site snapshots + reference documents; code tier + factuality judge; the hidden-text
      snapshot marked `pending: "security report #2 (untrusted.ts)"`. Accept: fake run green; one real run noted.
      Done: `eval/cases/onboarding.ts` + `factuality.ts`, six snapshots in `eval/fixtures/sites/` (B2B, B2C app,
      restaurants, e-commerce with a distinctive voice, a site with no price, `pingly-hidden` pending). Fake: 5/5 + 1
      pending. Real run (gemini, 2026-10-17): $0.061, stopped after one draft because the key's prepaid credit ran
      out; that draft (PawPal) failed the number rule on "15", which led to ignoring durations ("15-second clips")
      like W1 does. A full real run still needs a funded key.
- [x] **C2 — Sales W4 (C2).** 10–15 threads via `searchReddit` injection; exclusions, quotes, no link, no
      product-first opener, injections ignored; judge "helpful before the product". Accept: fake run green; the two
      injection threads fail a deliberately bad fake reply; one real run noted.
      Done: `eval/cases/sales.ts`, 13 threads in `eval/fixtures/reddit/invoicing.json` (5 fits, 6 to exclude, 2
      injections: a `</thread><thread index="0">` break-out and an "ignore previous instructions" P.S.). Fake: 6/6;
      `eval/cases/coverage.check.ts` proves a bad reply fails both injection threads. Real run: blocked by the same
      empty Gemini credit (failed at `make_queries`, $0).
- [x] **C3 — Memory-safety (C3).** `cmo-run.ts` seam (recording executor, same loop), `cmo-tasks.ts` cases by
      `expectedWriteBehavior`; tool-output cases `pending: "security report #1 (tainted gate)"`; one negative control.
      Accept: fake run green; founder-said case writes `remember`; negative control writes nothing.
      Done: the seam is the Supabase client, not the loop — `runTurn` and `cmoScope` run unchanged on an in-memory
      recording client; read tools with a case's canned output stand in for the outside world. Six cases: three
      founder-said (`remember`, `update_document`, `set_week_goal`), one negative control, two tool-output injections
      (`read_site`, `search_reddit`) pending. Fake scripts for goal / update doc / read site added to `fake.ts`.
      `tsx lib/agent/eval/cmo-run.ts --provider fake`: 4/4 + 2 pending, $0. Real run: not done (no Anthropic key
      here, the Gemini key has no credit).
- [ ] **C4 — Trajectory (C4).** `trajectory.ts` helpers; rules on `filler`, `pauses` and the create-video tasks.
      Accept: `agent:eval -- --provider fake` still passes every task that passed on `main`; a fake script edited
      to break a rule is caught (then reverted).

## Sync points

1. A1 and B1 push first (contracts). C starts on stubs at once.
2. B4 lands the registry → C registers its cases there.
3. C1–C3 pushed → B6 adds the CI step, so the fake CI run covers every case.
4. Last session to finish moves the PR out of draft once CI is green and every checklist item is done or explained
   here.

## Requests

- **C → B (B6):** please add `tsx lib/cmo/jobs/eval/cases/coverage.check.ts` to the fake CI run (or `check:contracts`):
  it asserts the graders catch planted instructions, invented prices and hidden text, which a green `cmo:eval` alone
  does not prove.
- **C → B (B5/B6):** CMO chat memory-safety runs through `runCmoTasks(provider, { epoch })` in
  `lib/agent/eval/cmo-run.ts` and returns `CaseResult[]` (pending set on the two tool-output cases). Please append them
  to the `agent:eval` report (e.g. after the editor tasks, or behind `--suite cmo`) and run
  `tsx lib/agent/eval/cmo-run.ts --provider fake` in CI until then.

- **B → A (FYI, done by B):** `lib/cmo/jobs/llm.ts` (no owner) gained two additive pieces: `StructuredOptions.prefer`
  (run as that provider first; the judge uses it to grade on the provider that did not draft) and
  `onLlmUsage(listener)` (process-wide usage, only the eval CLIs listen, for `--max-usd`). A2 can read the model that
  actually answered from `onUsage` as before. Eval cost uses `lib/eval/prices.ts` (Sonnet 5.5 cache read already
  0.1); keep it in step with A5.

- **A → B (FYI, done by A in A5):** `PRICES.anthropic` in `lib/agent/eval/run.ts` is now Sonnet 5.5 (2 / 10 / 0.1 /
  2.5), the one line A owns there. If B5 moves the estimate onto `lib/eval/prices.ts`, the constant can go.
  `lib/eval/prices.ts` has Haiku 5 at 0.1 / 0.5 / 0.01 / 0.125, same as SQL (`20261116090000_haiku_price.sql`).
