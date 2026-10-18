/**
 * The comparison statistics against hand-computed values: if these drift, every "BETTER"/"WORSE"
 * an eval prints is wrong.
 */
import assert from "node:assert/strict";

import { cohensKappa, compareReports, kOfK, mcnemarExact, summarize, type CaseResult, type EvalReport } from "./compare";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

// Exact binomial tails, two-sided: 2 · Σ_{i≤k} C(n, i) / 2^n.
close(mcnemarExact(0, 0), 1);
close(mcnemarExact(0, 5), 2 / 32);
close(mcnemarExact(6, 0), 2 / 64);
close(mcnemarExact(1, 9), (2 * (1 + 10)) / 1024);
close(mcnemarExact(3, 7), (2 * (1 + 10 + 45 + 120)) / 1024);
close(mcnemarExact(5, 5), 1);
close(mcnemarExact(9, 1), mcnemarExact(1, 9));
// Large n stays finite and tiny (no underflow to 0 or NaN).
assert.ok(mcnemarExact(0, 400) > 0 && mcnemarExact(0, 400) < 1e-100);
assert.throws(() => mcnemarExact(-1, 2));

const report = (cases: CaseResult[]): EvalReport => ({
  suite: "cmo",
  git: { head: "x", diffHash: null },
  provider: "fake",
  model: null,
  prompt_versions: {},
  started_at: "2026-10-17T00:00:00Z",
  cases,
});
const result = (id: string, pass: boolean | null, epoch = 0, extra: Partial<CaseResult> = {}): CaseResult => ({ id, epoch, pass, decided_by: "code", ...extra });

// Identical reports: nothing changed, p = 1, no verdict.
{
  const cases = Array.from({ length: 8 }, (_, i) => result(`w2:f${i}:0`, i % 3 !== 0));
  const same = compareReports(report(cases), report(cases));
  assert.equal(same.verdict, "INCONCLUSIVE");
  assert.equal(same.p, 1);
  assert.equal(same.paired, 8);
  assert.deepEqual(same.changed, []);
}

// Six cases fixed, none broken: p = 2/64 < 0.05 → BETTER; mirrored → WORSE.
{
  const base = report(Array.from({ length: 10 }, (_, i) => result(`c${i}`, i >= 6)));
  const next = report(Array.from({ length: 10 }, (_, i) => result(`c${i}`, true)));
  const better = compareReports(base, next);
  assert.equal(better.c, 6);
  assert.equal(better.b, 0);
  assert.equal(better.verdict, "BETTER");
  assert.equal(compareReports(next, base).verdict, "WORSE");
}

// Five changes the same way is still p = 0.0625: not enough to call.
{
  const base = report(Array.from({ length: 5 }, (_, i) => result(`c${i}`, true)));
  const next = report(Array.from({ length: 5 }, (_, i) => result(`c${i}`, false)));
  assert.equal(compareReports(base, next).verdict, "INCONCLUSIVE");
}

// Unscored, pending and one-sided cases are left out of the pairs, never counted as fails.
{
  const base = report([result("a", true), result("b", true), result("c", true), result("d", false, 0, { pending: "not built" })]);
  const next = report([result("a", null, 0, { decided_by: "judge" }), result("b", true), result("e", false), result("d", true, 0, { pending: "not built" })]);
  const out = compareReports(base, next);
  assert.equal(out.paired, 1);
  assert.deepEqual(out.unpaired, ["a", "c", "e"]);
}

// Epochs: majority per id; a tie is unscored.
{
  const cases = [result("x", true, 0), result("x", true, 1), result("x", false, 2), result("y", true, 0), result("y", false, 1), result("z", null, 0)];
  const k = kOfK(cases);
  assert.deepEqual(k.get("x"), { passed: 2, of: 3 });
  assert.deepEqual(k.get("y"), { passed: 1, of: 2 });
  assert.deepEqual(k.get("z"), { passed: 0, of: 0 });
  const out = compareReports(report(cases), report(cases));
  assert.equal(out.paired, 1);
  assert.deepEqual(out.unpaired, ["y", "z"]);
}

// Cohen's kappa: identical labels → 1; textbook 2×2 → 0.4; opposite → negative.
assert.equal(cohensKappa(["a", "b", "a", "c"], ["a", "b", "a", "c"]), 1);
assert.equal(cohensKappa(["a", "a"], ["a", "a"]), 1);
{
  // 50 items: 20 yes/yes, 5 yes/no, 10 no/yes, 15 no/no → po = 0.7, pe = 0.5 → κ = 0.4.
  const a = [...Array(20).fill("y"), ...Array(5).fill("y"), ...Array(10).fill("n"), ...Array(15).fill("n")];
  const b = [...Array(20).fill("y"), ...Array(5).fill("n"), ...Array(10).fill("y"), ...Array(15).fill("n")];
  close(cohensKappa(a, b), 0.4);
}
assert.ok(cohensKappa(["a", "b"], ["b", "a"]) < 0);
assert.throws(() => cohensKappa(["a"], []));

assert.deepEqual(summarize([result("a", true, 0, { cost_usd: 0.5 }), result("b", false), result("c", null), result("d", true, 0, { pending: "x" })]), {
  passed: 1,
  failed: 1,
  unscored: 1,
  pending: 1,
  cost: 0.5,
});

console.log("compare.check: ok");
