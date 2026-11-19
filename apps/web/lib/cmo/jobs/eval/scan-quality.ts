/**
 * Scan quality on real products (wave 4 B1, plan §4a.4): reads each site, drafts its documents, then runs a free scan
 * and a paid scan with the real readers and the real model, against an in-memory store (no database, no founder).
 * It writes every card to a JSON file and a markdown sheet with empty columns for scoring by hand: right person, real
 * pain in their words, fresh (under 7 days), a reply worth posting.
 *
 *   cd apps/web && set -a && source ../../.env.local && set +a
 *   NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/jobs/eval/scan-quality.ts \
 *     --site ferreto.io --site <saas-1> --site <saas-2> --max-usd 10 --yes
 *
 * COSTS MONEY: the model (onboarding, scoring, reach, drafts) and the reader (Lurk or ScrapeCreators credits). The model
 * spend is counted from each call's usage; reader calls are counted by host and priced at `--reader-usd` each (default
 * $0.002, ScrapeCreators' list price). It stops before the next step once the total passes `--max-usd`. A step already
 * started finishes. `--provider fake` checks the plumbing on `*.test` sites for nothing.
 *
 * The output holds what the public threads say (their own words, as the cards show them) and nothing about the founder
 * running it. No key is written anywhere.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Card = {
  site: string;
  scan: "free" | "paid";
  platform: string;
  community: string;
  url: string;
  title: string;
  posted_at: string | null;
  age_days: number | null;
  score: number;
  parts: string;
  rule: string | null;
  reach: string | null;
  reply: string;
};

function args() {
  const argv = process.argv.slice(2);
  const all = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]!] : []));
  const value = (flag: string) => all(flag)[0];
  return {
    sites: all("--site"),
    provider: (value("--provider") ?? "anthropic") as "fake" | "anthropic",
    yes: argv.includes("--yes"),
    maxUsd: Number(value("--max-usd") ?? 10),
    readerUsd: Number(value("--reader-usd") ?? 0.002),
    out: resolve(value("--out") ?? join(process.cwd(), ".cmo-eval", "scan-quality")),
    scans: (value("--scans") ?? "free,paid").split(",").filter((s): s is "free" | "paid" => s === "free" || s === "paid"),
  };
}

const READER_HOSTS = ["api.lurkapi.com", "api.scrapecreators.com"];

async function main() {
  const o = args();
  if (!o.sites.length) throw new Error("Name at least one --site.");
  if (!(o.maxUsd > 0)) throw new Error("--max-usd needs a positive number.");
  if (o.provider !== "fake" && !o.yes) {
    console.log(`This reads ${o.sites.length} sites and runs ${o.scans.join(" + ")} scans on each with the real model and readers. Add --yes; it stops after $${o.maxUsd}.`);
    return;
  }
  process.env.OPENCMO_AGENT_FAKE = o.provider === "fake" ? "1" : "";

  // Reader calls, counted at the wire: the spend ledger needs a database this run does not have.
  const readerCalls = new Map<string, number>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).host;
    if (READER_HOSTS.includes(host)) readerCalls.set(host, (readerCalls.get(host) ?? 0) + 1);
    return realFetch(input, init);
  }) as typeof fetch;

  const { onLlmUsage } = await import("../llm");
  const { usageUsd } = await import("@/lib/eval/prices");
  const { readSite } = await import("../../site");
  const { draftDocuments } = await import("../../generate");
  const { memoryStore } = await import("../memory-store");
  const { drainCmoQueue } = await import("../runner");

  let modelUsd = 0;
  const stop = onLlmUsage((usage) => void (modelUsd += usageUsd(usage)));
  const readerUsd = () => [...readerCalls.values()].reduce((a, b) => a + b, 0) * o.readerUsd;
  const spent = () => modelUsd + readerUsd();
  const over = () => spent() >= o.maxUsd;

  mkdirSync(o.out, { recursive: true });
  const cards: Card[] = [];
  const runs: { site: string; scan: string; status: string; error: string | null; output: unknown; usd: number }[] = [];
  const now = Date.now();
  try {
    for (const site of o.sites) {
      if (over()) break;
      const before = spent();
      console.log(`\n=== ${site}: reading the site`);
      const docs = await draftDocuments(await readSite(site));
      const slug = site.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_");
      writeFileSync(join(o.out, `${slug}.docs.json`), JSON.stringify(docs, null, 2));
      for (const scan of o.scans) {
        if (over()) break;
        const start = spent();
        const mem = memoryStore(docs as never, []);
        mem.account.paid = scan === "paid";
        const run = mem.enqueue("sales_scan", scan === "free" ? { source: "onboarding" } : {}, scan === "free" ? 0 : 1);
        console.log(`--- ${site}: ${scan} scan`);
        await drainCmoQueue(mem.store, { runId: run.id, budgetMs: 420_000 });
        const state = mem.runs.find((r) => r.id === run.id)!;
        runs.push({ site, scan, status: state.status, error: state.error, output: state.output, usd: +(spent() - start).toFixed(3) });
        console.log(`    ${state.status}${state.error ? `: ${state.error}` : ""} · ${mem.opps.filter((x) => x.rule !== "skip").length} cards · $${(spent() - start).toFixed(3)}`);
        for (const opp of mem.opps) {
          if (opp.rule === "skip") continue;
          const posted = opp.posted_at ? Date.parse(opp.posted_at) : NaN;
          const person = mem.people.get(opp.url);
          cards.push({
            site,
            scan,
            platform: opp.platform ?? "reddit",
            community: opp.community,
            url: opp.url,
            title: opp.title,
            posted_at: opp.posted_at,
            age_days: Number.isNaN(posted) ? null : +((now - posted) / 86_400_000).toFixed(1),
            score: opp.score,
            parts: opp.score_parts.map((p) => `${p.label} ${p.score}/${p.max}${p.evidence ? ` ${p.evidence}` : ""}`).join(" | "),
            rule: opp.rule ?? null,
            reach: person ? person.level : null,
            reply: opp.reply,
          });
        }
      }
      console.log(`=== ${site}: $${(spent() - before).toFixed(3)}`);
    }
  } finally {
    stop();
    globalThis.fetch = realFetch;
  }

  const summary = { model_usd: +modelUsd.toFixed(3), reader_calls: Object.fromEntries(readerCalls), reader_usd: +readerUsd().toFixed(3), total_usd: +spent().toFixed(3), capped: over() };
  writeFileSync(join(o.out, "cards.json"), JSON.stringify({ summary, runs, cards }, null, 2));
  const cell = (s: string | number | null) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 300);
  const sheet = [
    "| # | site | scan | platform | community | age (d) | score | reach | title | right person | real pain | fresh | reply worth posting |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...cards.map((c, i) => `| ${i + 1} | ${cell(c.site)} | ${c.scan} | ${c.platform} | ${cell(c.community)} | ${c.age_days ?? "?"} | ${c.score} | ${c.reach ?? ""} | [${cell(c.title)}](${c.url}) |  |  | ${c.age_days !== null && c.age_days < 7 ? "y" : "n"} |  |`),
  ].join("\n");
  writeFileSync(join(o.out, "sheet.md"), `${sheet}\n`);
  console.log(`\n${cards.length} cards · ${JSON.stringify(summary)}\n→ ${o.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
