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
import { POST_CHANNELS } from "../../../documents";
import { draftDocuments, finishDrafts } from "../../../generate";
import { keepFounderBrand } from "../../../onboard";
import { extractLook } from "../../../site-look";
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
  // Wave 3 B4: documents v2. B2B channels only, the founder's samples left to them, the look only from the markup.
  const channels = drafts.post_plan.channels;
  if (!channels.length || channels.some((c) => !(POST_CHANNELS as readonly string[]).includes(c))) issues.push(`post plan channels ${JSON.stringify(channels)}`);
  if (drafts.brand.voice_samples.length) issues.push("writes the founder's writing samples");
  if (JSON.stringify(drafts.brand.look.colors) !== JSON.stringify(site.snapshot.look?.colors ?? [])) issues.push(`colours ${JSON.stringify(drafts.brand.look.colors)} are not the website's`);
  if (opts.prices && !drafts.strategy.where_they_ask.length) issues.push("no places where these customers ask");
  if (opts.prices && !drafts.strategy.this_week.trim()) issues.push("no focus for this week");
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
    factuality("one-liner", drafts.product.one_liner, site.reference.one_liner),
    factuality("ideal customer", drafts.strategy.icp, site.reference.icp),
  ]);
  const [oneLiner, icp] = graded.map((g) => g.label);
  const cost = graded.reduce((sum, g) => sum + g.cost_usd, 0);
  const verdict = `one_liner:${oneLiner ?? "?"} icp:${icp ?? "?"}`;
  if (oneLiner === null || icp === null) return { ...base, pass: null, decided_by: "error", verdict, cost_usd: cost, notes: [...notes, "judge failed: unscored"] };
  const contradicts = [oneLiner === "D" && "one-liner contradicts the website", icp === "D" && "ICP contradicts the website"].filter((note): note is string => Boolean(note));
  return { ...base, pass: !contradicts.length, decided_by: "judge", verdict, cost_usd: cost, notes: [...notes, ...contradicts] };
}

/**
 * Wave 3 B4 in code: the look read from fixed markup, the founder's answer as the ideal customer, the default channels,
 * and a second read of the website keeping what the founder put in the Brand.
 */
function runLook(env: EvalEnv): CaseResult[] {
  const id = (output: string) => `w0:look:${output}`;
  const result = (name: string, pass: boolean, notes: string[] = []): CaseResult => ({ id: id(name), epoch: env.epoch, pass, decided_by: "code", notes });
  const html = `<html><head><meta name="theme-color" content="#C93A0F"><link rel="icon" href="/favicon.png">
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap" rel="stylesheet">
    <style>:root{--brand-accent:#1f6feb;--bg:#ffffff;--text:#222}.btn{background:#1f6feb;color:#fff}.tag{color:#2da44e}</style></head>
    <body><img src="/img/logo.svg" alt="Duely logo"><h1>Get paid</h1></body></html>`;
  const look = extractLook("https://duely.example/", html);
  const plain = extractLook("http://plain.example/", `<html><head><link rel="icon" href="data:image/png;base64,xx"></head><body style="font-family: Arial, sans-serif; color:#333333">Hi</body></html>`);
  const site = SITES[0]!;
  const drafts = {
    product: { name: "Duely", one_liner: "", description: "", audience: "", problems: [], features: [], pricing: "", category: "" },
    strategy: { icp: "Not stated on the website", pains: [], where_they_ask: [], positioning: "", value_props: [], this_week: "" },
    competitors: { competitors: [] },
    post_plan: { topics: [], channels: [], rhythm: "" },
    brand: { voice: "", voice_samples: ["made up"], intro_line: "", avoid: [], look: { logo_url: "https://guess.example/x.png", colors: ["#000001"], font: "Guess", screenshots: [], image_styles: ["Clean screenshots"] } },
  } as OnboardingDrafts;
  const finished = finishDrafts(drafts, { ...site.snapshot, look }, "Freelance designers who invoice clients monthly");
  const again = keepFounderBrand(finished, { voice_samples: ["My own post about late invoices."], intro_line: "I make Duely so freelancers stop chasing.", look: { screenshots: ["brand/u/1.png"] } });
  return [
    result("logo", look.logo_url === "https://duely.example/img/logo.svg", [look.logo_url]),
    result("colors", JSON.stringify(look.colors) === JSON.stringify(["#c93a0f", "#1f6feb", "#2da44e"]), look.colors),
    result("font", look.font === "Space Grotesk", [look.font]),
    result("nothing-guessed", plain.logo_url === "" && plain.colors.length === 0 && plain.font === "", [JSON.stringify(plain)]),
    result("look-from-markup", finished.brand.look.logo_url === look.logo_url && finished.brand.look.font === "Space Grotesk" && finished.brand.look.image_styles.length === 1),
    result("no-samples-written", finished.brand.voice_samples.length === 0),
    result("founder-answer", finished.strategy.icp === "Freelance designers who invoice clients monthly", [finished.strategy.icp]),
    result("default-channels", JSON.stringify(finished.post_plan.channels) === JSON.stringify(["x", "linkedin", "threads"]), finished.post_plan.channels),
    result("reread-keeps-founder-brand", again.brand.voice_samples[0] === "My own post about late invoices." && again.brand.intro_line.startsWith("I make Duely") && again.brand.look.screenshots[0] === "brand/u/1.png" && again.brand.look.font === "Space Grotesk"),
  ];
}

export const onboardingCase: EvalCase = {
  job: "w0",
  once: true,
  async run(_fixture, env) {
    const results: CaseResult[] = [];
    for (const site of SITES) results.push(await runSite(site, env));
    results.push(...runLook(env));
    return results;
  },
};

registerCases([onboardingCase]);
