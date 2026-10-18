/**
 * The eval runner without models: the spend cap stops new case runs (never one in progress), a
 * crashing case fails instead of stopping the run, and costs add up to what was spent.
 */
import assert from "node:assert/strict";

import type { LlmUsage } from "../llm";
import { fakeJudge } from "../judge";
import { runCases, tableRow } from "./runner";
import type { EvalCase, EvalFixture } from "./types";

const fixture = (name: string): EvalFixture => ({ name, docs: {}, brief: "", clips: [] });
const FIXTURES = [fixture("a"), fixture("b"), fixture("c")];

async function main() {
  // A fake meter: each call to `spend` is one structured call's usage.
  const listeners = new Set<(usage: LlmUsage, agent: never) => void>();
  const usage = ((listener: (usage: LlmUsage, agent: never) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }) as never;
  // $1 of Sonnet 5.5 output (100k tokens at $10/M).
  const spend = (agent: string) => {
    for (const listener of listeners) listener({ model: "claude-sonnet-5-5", input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 }, agent as never);
  };

  const paid: EvalCase = {
    job: "w2",
    async run(f, env) {
      spend("x_writer");
      env.recordGen("w2", { model: "m", prompt_version: "abc123" });
      return [
        { id: `w2:${f.name}:run`, epoch: env.epoch, pass: true, decided_by: "code" },
        { id: `w2:${f.name}:0`, epoch: env.epoch, pass: null, decided_by: "error" },
        { id: `w2:${f.name}:1`, epoch: env.epoch, pass: false, decided_by: "code", pending: "not built" },
      ];
    },
  };
  const out = await runCases({ cases: [paid], fixtures: FIXTURES, epochs: 2, provider: "fake", judge: fakeJudge(), drain: (async () => 0) as never, maxUsd: 1.5, usage });
  // $1 per run: the second run starts at $1 < $1.5 and finishes at $2; nothing starts after.
  assert.equal(out.runs.length, 2);
  assert.equal(out.skipped, 4);
  assert.ok(Math.abs(out.spentUsd - 2) < 1e-9);
  assert.ok(Math.abs(out.runs.flatMap((r) => r.results).reduce((s, r) => s + (r.cost_usd ?? 0), 0) - 2) < 1e-9);
  assert.deepEqual(out.promptVersions, { w2: "abc123" });
  assert.deepEqual([...out.models.get("x_writer")!], ["claude-sonnet-5-5"]);
  assert.equal(listeners.size, 0, "the meter is released");
  const row = tableRow(out.runs[0]!);
  assert.deepEqual([row.ok, row.passing, row.unscored, row.of], [true, 0, 1, 1]);

  // A case that throws is a failed run; the next case still runs. `once` runs one time per epoch.
  const crash: EvalCase = { job: "w4", once: true, run: async () => { throw new Error("boom"); } };
  const fine: EvalCase = { job: "w1", run: async (f, env) => [{ id: `w1:${f.name}:run`, epoch: env.epoch, pass: true, decided_by: "code" }] };
  const mixed = await runCases({ cases: [crash, fine], fixtures: FIXTURES, epochs: 1, provider: "fake", judge: fakeJudge(), drain: (async () => 0) as never, maxUsd: null, usage });
  assert.equal(mixed.runs.length, 4);
  assert.deepEqual(mixed.runs[0]!.results.map((r) => [r.id, r.pass, r.decided_by]), [["w4:all:run", false, "error"]]);
  assert.equal(tableRow(mixed.runs[0]!).ok, false);
  assert.match(tableRow(mixed.runs[0]!).error ?? "", /boom/);

  console.log("eval runner.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
