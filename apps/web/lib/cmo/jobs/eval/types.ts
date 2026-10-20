/**
 * The `cmo:eval` case registry. A case is one job graded on one fixture product; each file under
 * `eval/cases/` registers its own cases at import time, so sessions adding coverage never edit a
 * shared list. The runner (`eval/runner.ts`) owns epochs, the cost cap and the report.
 */

import type { CaseResult } from "@/lib/eval/compare";

import type { Judge } from "../judge";
import type { drainCmoQueue } from "../runner";
import type { Documents } from "../types";

export type EvalFixture = { name: string; docs: Documents; brief: string };

export type EvalEnv = {
  drain: typeof drainCmoQueue;
  /** "fake" or a real provider name; cases may skip printing model output on fake runs. */
  provider: string;
  judge: Judge;
  epoch: number;
  /** Lines a real run prints under the table (what the model wrote), so a person can read it. */
  log: (line: string) => void;
  /** Where an output came from (`body.gen` / `opportunities.gen`): its prompt version goes in the report under `key`. */
  recordGen: (key: string, gen: unknown) => void;
};

export type EvalCase = {
  /** Selected with `--job`: "w1", "w2", "w0", "w4", … */
  job: string;
  /**
   * `true` runs the case once per epoch with no shared fixture (it brings its own, e.g. site
   * snapshots or Reddit threads); `fixture` is then the first shared one and can be ignored.
   * Default: once per shared fixture.
   */
  once?: boolean;
  run(fixture: EvalFixture, env: EvalEnv): Promise<CaseResult[]>;
};

const REGISTRY: EvalCase[] = [];

export function registerCases(cases: EvalCase[]): void {
  REGISTRY.push(...cases);
}

export function registeredCases(): readonly EvalCase[] {
  return REGISTRY;
}
