/**
 * One report format for both eval suites (`cmo:eval`, `agent:eval`) and the statistics to compare
 * two runs. A pass rate alone cannot say "this prompt change made W2 worse": two runs of the same
 * cases are paired by case id and tested with McNemar's exact test, which only looks at the cases
 * that changed. Written from the textbook formulas; no eval platform, no dependency.
 */

export type CaseResult = {
  /** Stable across runs, so two reports pair up: `${job}:${fixture}:${output}`. */
  id: string;
  epoch: number;
  /** null = unscored: the judge failed or answered a label we do not know. Never counted as a fail. */
  pass: boolean | null;
  decided_by: "code" | "judge" | "error";
  /** Judge label, e.g. "post_as_is". */
  verdict?: string;
  notes?: string[];
  cost_usd?: number;
  /** Why the case cannot pass yet (a feature it guards is not built). Reported apart, never fails a run. */
  pending?: string;
};

export type EvalReport = {
  suite: "cmo" | "agent";
  git: { head: string; diffHash: string | null };
  provider: string;
  model: string | null;
  prompt_versions: Record<string, string>;
  started_at: string;
  cases: CaseResult[];
};

export type Verdict = "BETTER" | "WORSE" | "INCONCLUSIVE";

export type Comparison = {
  /** Cases scored on both sides. */
  paired: number;
  /** Passed in base, failed in next. */
  b: number;
  /** Failed in base, passed in next. */
  c: number;
  changed: { id: string; base: boolean; next: boolean }[];
  /** Ids present in only one report, or unscored on one side. */
  unpaired: string[];
  p: number;
  verdict: Verdict;
};

const ALPHA = 0.05;

/**
 * Two-sided exact McNemar p: under "no change", each of the n = b + c discordant pairs is a fair
 * coin, so p = 2 · P(X ≤ min(b, c)) for X ~ Binomial(n, ½), capped at 1. Summed in log space so a
 * few hundred cases do not underflow.
 */
export function mcnemarExact(b: number, c: number): number {
  if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || c < 0) throw new Error(`mcnemarExact needs counts, got ${b}, ${c}`);
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  const logHalfN = n * Math.log(0.5);
  let logChoose = 0; // log C(n, 0)
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logChoose + logHalfN);
  }
  return Math.min(1, 2 * tail);
}

/** Passed epochs out of scored epochs per case id; pending cases are left out. */
export function kOfK(cases: CaseResult[]): Map<string, { passed: number; of: number }> {
  const out = new Map<string, { passed: number; of: number }>();
  for (const result of cases) {
    if (result.pending) continue;
    const entry = out.get(result.id) ?? { passed: 0, of: 0 };
    if (result.pass !== null) {
      entry.of += 1;
      if (result.pass) entry.passed += 1;
    }
    out.set(result.id, entry);
  }
  return out;
}

/** One outcome per case: the majority of its scored epochs. A tie or no scored epoch is unscored. */
function majority(cases: CaseResult[]): Map<string, boolean | null> {
  const out = new Map<string, boolean | null>();
  for (const [id, { passed, of }] of kOfK(cases)) out.set(id, of === 0 || passed * 2 === of ? null : passed * 2 > of);
  return out;
}

export function compareReports(base: EvalReport, next: EvalReport): Comparison {
  const before = majority(base.cases);
  const after = majority(next.cases);
  const changed: Comparison["changed"] = [];
  const unpaired: string[] = [];
  let paired = 0;
  let b = 0;
  let c = 0;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const x = before.get(id);
    const y = after.get(id);
    if (x === undefined || y === undefined || x === null || y === null) {
      unpaired.push(id);
      continue;
    }
    paired += 1;
    if (x === y) continue;
    changed.push({ id, base: x, next: y });
    if (x) b += 1;
    else c += 1;
  }
  const p = mcnemarExact(b, c);
  const verdict: Verdict = p < ALPHA && b !== c ? (c > b ? "BETTER" : "WORSE") : "INCONCLUSIVE";
  return { paired, b, c, changed: changed.sort((l, r) => l.id.localeCompare(r.id)), unpaired: unpaired.sort(), p, verdict };
}

/**
 * Agreement between two raters beyond chance (judge vs. a human label, or two judges): 1 is full
 * agreement, 0 is what chance alone gives. Both raters giving one same label everywhere is 1.
 */
export function cohensKappa(a: string[], b: string[]): number {
  if (a.length !== b.length) throw new Error(`cohensKappa needs two equal-length lists, got ${a.length} and ${b.length}`);
  const n = a.length;
  if (n === 0) return 1;
  let agree = 0;
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree += 1;
    countA.set(a[i]!, (countA.get(a[i]!) ?? 0) + 1);
    countB.set(b[i]!, (countB.get(b[i]!) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [label, count] of countA) pe += (count / n) * ((countB.get(label) ?? 0) / n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

/** Totals for the console: scored passes, unscored and pending, counting every epoch. */
export function summarize(cases: CaseResult[]): { passed: number; failed: number; unscored: number; pending: number; cost: number } {
  let passed = 0;
  let failed = 0;
  let unscored = 0;
  let pending = 0;
  let cost = 0;
  for (const result of cases) {
    cost += result.cost_usd ?? 0;
    if (result.pending) pending += 1;
    else if (result.pass === null) unscored += 1;
    else if (result.pass) passed += 1;
    else failed += 1;
  }
  return { passed, failed, unscored, pending, cost };
}

export function formatComparison(result: Comparison): string[] {
  const lines = [
    `compare: ${result.verdict} · ${result.paired} paired · ${result.b} got worse, ${result.c} got better · McNemar exact p = ${result.p.toFixed(4)}`,
  ];
  for (const change of result.changed) lines.push(`  ${change.next ? "+" : "-"} ${change.id}`);
  if (result.unpaired.length) lines.push(`  (${result.unpaired.length} cases not compared: missing or unscored on one side)`);
  return lines;
}
