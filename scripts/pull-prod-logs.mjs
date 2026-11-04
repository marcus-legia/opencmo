#!/usr/bin/env node
/**
 * Saves production's error logs before Vercel drops them (1 hour on Hobby, 1 day on Pro).
 *
 *   npm run qa:logs                  # the last 24 hours
 *   npm run qa:logs -- --since 2h
 *
 * Read-only. Pulls two sets and merges them by id: our own `opencmo_log` lines (lib/log.ts) and every 5xx, which also
 * catches a crash that never reached our logger. Writes docs/qa/logs/<time>.jsonl, gitignored because lines carry user
 * ids. Needs a logged-in Vercel CLI. The worker logs elsewhere: see docs/qa/2026-11-production-test-checklist.md.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "opencmo";
const SCOPE = "marcus-projects-dbe7eaa1";
const PAGE = 1000;
const MAX_PAGES = 20;

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function fetchPage(filter, since, until) {
  const args = ["logs", "--environment", "production", "--no-branch", "--json", "--project", PROJECT, "--scope", SCOPE];
  args.push("--limit", String(PAGE), "--since", since, ...filter);
  if (until) args.push("--until", until);
  const run = spawnSync("vercel", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 512 });
  if (run.error || run.status !== 0) {
    console.error(`vercel logs failed: ${run.error?.message ?? run.stderr}`);
    process.exit(1);
  }
  return run.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

/** `vercel logs` returns one bounded page, newest first: walk back with `--until` until a page comes up short. */
function fetchAll(filter, since) {
  const records = [];
  let until;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = fetchPage(filter, since, until);
    records.push(...rows);
    if (rows.length < PAGE) return { records, complete: true };
    until = new Date(Math.min(...rows.map((row) => row.timestamp))).toISOString();
  }
  return { records, complete: false };
}

function eventName(record) {
  const texts = [record.message, ...(record.logs ?? []).map((log) => log.message)];
  for (const text of texts) {
    if (!text?.includes('"opencmo_log"')) continue;
    try {
      return JSON.parse(text.slice(text.indexOf("{"))).event;
    } catch {
      return "opencmo_log (unparsed)";
    }
  }
  return `http ${record.responseStatusCode}`;
}

const since = option("since", "24h");
const sets = [fetchAll(["--query", "opencmo_log"], since), fetchAll(["--status-code", "5xx"], since)];

const byId = new Map();
for (const record of sets.flatMap((set) => set.records)) byId.set(record.id, record);
const records = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);

const dir = join(ROOT, "docs/qa/logs");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));

const counts = new Map();
for (const record of records) {
  const name = eventName(record);
  counts.set(name, (counts.get(name) ?? 0) + 1);
}
console.log(`${records.length} records from the last ${since} → ${relative(process.cwd(), file)}`);
for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${name}`);
if (sets.some((set) => !set.complete)) {
  console.warn(`WARNING: stopped after ${MAX_PAGES} pages, so the oldest logs in this window are missing. Use a shorter --since.`);
}
