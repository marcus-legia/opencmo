/**
 * Reading and writing `EvalReport` files (Node only). The git head and a hash of the uncommitted
 * diff go in every report: two runs on "the same commit" with different local edits must not be
 * read as the same code.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { compareReports, formatComparison, type EvalReport } from "./compare";

export function gitInfo(): EvalReport["git"] {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return null;
    }
  };
  const head = git("rev-parse", "HEAD")?.trim() || "unknown";
  const diff = git("diff", "HEAD");
  return { head, diffHash: diff ? createHash("sha256").update(diff).digest("hex").slice(0, 16) : null };
}

export function writeReport(path: string, report: EvalReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

export function readReport(path: string): EvalReport {
  const report = JSON.parse(readFileSync(path, "utf8")) as EvalReport;
  if (!report || !Array.isArray(report.cases) || (report.suite !== "cmo" && report.suite !== "agent")) throw new Error(`${path} is not an eval report.`);
  return report;
}

/** Prints the comparison against `basePath`; a different suite cannot be paired. */
export function printComparison(basePath: string, next: EvalReport): void {
  const base = readReport(basePath);
  if (base.suite !== next.suite) throw new Error(`Cannot compare a ${base.suite} report with a ${next.suite} report.`);
  console.log(`\nbase: ${basePath} (${base.provider}${base.model ? ` ${base.model}` : ""}, ${base.git.head.slice(0, 7)}${base.git.diffHash ? "+dirty" : ""})`);
  for (const line of formatComparison(compareReports(base, next))) console.log(line);
}
