/**
 * Runs registered `cmo:eval` cases: every case × fixture × epoch, in order, with a spend cap.
 * Spend is counted from every structured call's usage (drafts, checks and the judge), so the cap
 * holds even for cases that do not report a cost. A case already started always finishes: the cap
 * stops new cases, it never cuts a run in half.
 */

import type { CaseResult } from "@/lib/eval/compare";
import { usageUsd } from "@/lib/eval/prices";

import type { Judge } from "../judge";
import { onLlmUsage } from "../llm";
import type { drainCmoQueue } from "../runner";
import type { EvalCase, EvalFixture } from "./types";

export type RunOptions = {
  cases: readonly EvalCase[];
  fixtures: readonly EvalFixture[];
  epochs: number;
  provider: string;
  judge: Judge;
  drain: typeof drainCmoQueue;
  maxUsd: number | null;
  /** Called after each case run, for live progress. */
  onRun?: (run: CaseRun) => void;
  /** Where usage comes from; tests feed their own. */
  usage?: typeof onLlmUsage;
};

export type CaseRun = { job: string; fixture: string; epoch: number; seconds: number; results: CaseResult[]; lines: string[] };

export type RunOutcome = {
  runs: CaseRun[];
  spentUsd: number;
  /** Case runs not started because the cap was reached. */
  skipped: number;
  /** Models that answered, by agent (the judge's `checker` included). */
  models: Map<string, Set<string>>;
  promptVersions: Record<string, string>;
};

export async function runCases(options: RunOptions): Promise<RunOutcome> {
  let spent = 0;
  const models = new Map<string, Set<string>>();
  const promptVersions: Record<string, string> = {};
  const stop = (options.usage ?? onLlmUsage)((usage, agent) => {
    spent += usageUsd(usage);
    const seen = models.get(agent) ?? new Set<string>();
    seen.add(usage.model);
    models.set(agent, seen);
  });
  const runs: CaseRun[] = [];
  let skipped = 0;
  try {
    for (let epoch = 0; epoch < options.epochs; epoch++) {
      for (const evalCase of options.cases) {
        const fixtures = evalCase.once ? options.fixtures.slice(0, 1) : options.fixtures;
        for (const fixture of fixtures) {
          if (options.maxUsd !== null && spent >= options.maxUsd) {
            skipped += 1;
            continue;
          }
          const lines: string[] = [];
          const before = spent;
          const started = Date.now();
          let results: CaseResult[];
          try {
            results = await evalCase.run(fixture, {
              drain: options.drain,
              provider: options.provider,
              judge: options.judge,
              epoch,
              log: (line) => lines.push(line),
              recordGen: (key, gen) => {
                const version = (gen as { prompt_version?: unknown } | null)?.prompt_version;
                if (typeof version === "string" && version) promptVersions[key] = version;
              },
            });
          } catch (error) {
            // A crash is our harness or job code failing, not the model: it fails the run.
            results = [{ id: `${evalCase.job}:${evalCase.once ? "all" : fixture.name}:run`, epoch, pass: false, decided_by: "error", notes: [error instanceof Error ? (error.stack ?? error.message) : String(error)] }];
          }
          // What the case spent besides the judge's own reported cost (drafts, job checks) goes on
          // its first result, so the report's costs add up to the real spend.
          const reported = results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
          const rest = spent - before - reported;
          if (rest > 0 && results[0]) results[0] = { ...results[0], cost_usd: (results[0].cost_usd ?? 0) + rest };
          const run: CaseRun = { job: evalCase.job, fixture: evalCase.once ? "all" : fixture.name, epoch, seconds: (Date.now() - started) / 1000, results, lines };
          runs.push(run);
          options.onRun?.(run);
        }
      }
    }
  } finally {
    stop();
  }
  return { runs, spentUsd: spent, skipped, models, promptVersions };
}

/** One table row per case run: `:run` is whether it finished; the other results are its outputs. */
export function tableRow(run: CaseRun) {
  const head = run.results.find((r) => r.id.endsWith(":run"));
  const outputs = run.results.filter((r) => r !== head && !r.pending);
  const ok = head ? head.pass === true : outputs.every((r) => r.pass !== false);
  return {
    job: run.job,
    fixture: run.fixture,
    epoch: run.epoch,
    ok,
    passing: outputs.filter((r) => r.pass === true).length,
    unscored: outputs.filter((r) => r.pass === null).length,
    of: outputs.length,
    seconds: run.seconds.toFixed(1),
    cost: `$${run.results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0).toFixed(3)}`,
    error: head?.pass === false ? (head.notes?.[0] ?? null)?.split("\n")[0] ?? null : null,
  };
}
