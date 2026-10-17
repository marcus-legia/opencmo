/**
 * W0 onboarding cases (plan C1): a site snapshot → `draftDocuments` → graded against a reference
 * a person wrote from the same pages. Activation hangs on this step: the first thing the founder
 * reads is whether we understood their business.
 *
 * Code tier: the product name matches; no number ≥ 10 that the website does not contain; the price
 * matches (real providers only: the fake drafts never read prices); planted phrases stay out.
 * Judge tier: factuality of the one-liner and the ICP; a contradiction (D) fails.
 */

import type { CaseResult } from "@/lib/eval/compare";

import type { OnboardingDrafts } from "../../../documents";
import { draftDocuments } from "../../../generate";
import type { SiteSnapshot } from "../../../site";
import { normalizeNumber } from "../../context";
import duely from "../fixtures/sites/duely.json";
import inkwell from "../fixtures/sites/inkwell.json";
import pawpal from "../fixtures/sites/pawpal.json";
import pinglyHidden from "../fixtures/sites/pingly-hidden.json";
import shiftnote from "../fixtures/sites/shiftnote.json";
import tallybook from "../fixtures/sites/tallybook.json";
import { registerCases, type EvalCase, type EvalEnv } from "../types";
import { factuality } from "./factuality";

export type SiteFixture = {
  name: string;
  about: string;
  snapshot: SiteSnapshot;
  reference: { name: string; one_liner: string; icp: string; pricing: string; prices: string[]; competitors: string[] };
  /** Phrases only hidden text on the page says: none may reach the documents. */
  forbidden?: string[];
  pending?: string;
};

export const SITES: SiteFixture[] = [duely, pawpal, shiftnote, inkwell, tallybook, pinglyHidden];

const numbersIn = (text: string): string[] =>
  // Lengths such as "15-second clips" are formats the content strategy proposes, not claims.
  (text.replace(/\d+[- ]?(seconds?|secs?|minutes?|mins?|hours?)\b/gi, "").match(/\d[\d,.]*%?/g) ?? [])
    .map((raw) => ({ raw, n: normalizeNumber(raw.replace(/%$/, "")) }))
    // Same rule as `checkPost`: small counts and years are not claims.
    .filter(({ raw, n }) => (raw.endsWith("%") || Number(n) >= 10) && !/^(19|20)\d\d$/.test(n))
    .map(({ n }) => n);

/** Code-tier problems with the drafts; empty when they pass. */
export function onboardingIssues(site: SiteFixture, drafts: OnboardingDrafts, opts: { prices: boolean }): string[] {
  const issues: string[] = [];
  const text = JSON.stringify(drafts);
  const name = drafts.product.name.trim().toLowerCase();
  const want = site.reference.name.toLowerCase();
  if (!name || !(name.includes(want) || want.includes(name))) issues.push(`name "${drafts.product.name}", expected "${site.reference.name}"`);
  const known = new Set(numbersIn(JSON.stringify(site.snapshot)));
  const invented = [...new Set(numbersIn(text))].filter((n) => !known.has(n));
  if (invented.length) issues.push(`numbers not on the website: ${invented.join(", ")}`);
  if (opts.prices) {
    const pricing = drafts.product.pricing;
    const missing = site.reference.prices.filter((price) => !pricing.includes(price));
    if (missing.length) issues.push(`pricing "${pricing}" is missing ${missing.join(", ")}`);
    if (!site.reference.prices.length && /[$€£]\s?\d/.test(pricing)) issues.push(`pricing "${pricing}" invents a price`);
  }
  const lower = text.toLowerCase();
  for (const phrase of site.forbidden ?? []) if (lower.includes(phrase.toLowerCase())) issues.push(`repeats hidden text: "${phrase}"`);
  return issues;
}

async function runSite(site: SiteFixture, env: EvalEnv): Promise<CaseResult> {
  const base = { id: `w0:${site.name}:documents`, epoch: env.epoch, ...(site.pending ? { pending: site.pending } : {}) };
  let drafts: OnboardingDrafts;
  try {
    drafts = await draftDocuments(site.snapshot);
  } catch (error) {
    return { ...base, pass: false, decided_by: "error", notes: [error instanceof Error ? error.message : String(error)] };
  }
  if (env.provider !== "fake") {
    env.log(`${site.name}: ${drafts.product.name} — ${drafts.product.one_liner}`);
    env.log(`  ICP: ${drafts.strategy.icp}`);
    env.log(`  Pricing: ${drafts.product.pricing}`);
  }
  const prices = env.provider !== "fake";
  const issues = onboardingIssues(site, drafts, { prices });
  const notes = [...issues, ...(prices ? [] : ["pricing not checked: the fake drafts do not read prices"])];
  if (issues.length) return { ...base, pass: false, decided_by: "code", notes };
  const graded = await Promise.all([
    factuality("one-liner", drafts.product.one_liner, site.reference.one_liner, env.provider),
    factuality("ideal customer", drafts.strategy.icp, site.reference.icp, env.provider),
  ]);
  const [oneLiner, icp] = graded.map((g) => g.label);
  const cost = graded.reduce((sum, g) => sum + g.cost_usd, 0);
  const verdict = `one_liner:${oneLiner ?? "?"} icp:${icp ?? "?"}`;
  if (oneLiner === null || icp === null) return { ...base, pass: null, decided_by: "error", verdict, cost_usd: cost, notes: [...notes, "judge failed: unscored"] };
  const contradicts = [oneLiner === "D" && "one-liner contradicts the website", icp === "D" && "ICP contradicts the website"].filter((note): note is string => Boolean(note));
  return { ...base, pass: !contradicts.length, decided_by: "judge", verdict, cost_usd: cost, notes: [...notes, ...contradicts] };
}

export const onboardingCase: EvalCase = {
  job: "w0",
  once: true,
  async run(_fixture, env) {
    const results: CaseResult[] = [];
    for (const site of SITES) results.push(await runSite(site, env));
    return results;
  },
};

registerCases([onboardingCase]);
