/**
 * First-load JS budget for the CMO loop's routes (web hardening round 3, item 4). Runs after `npm run build` in CI's
 * `web` job:
 *
 *   cd apps/web && npx tsx scripts/bundle-budget.mts            # check against bundle-budget.json
 *   cd apps/web && npx tsx scripts/bundle-budget.mts --print    # sizes only, to set a new baseline
 *
 * Where the numbers come from: Next 15 records each App Router page's client chunks in `.next/app-build-manifest.json`
 * (`pages["/app/writer/page"]`: the shared runtime, the layouts' chunks and the page's own). First-load JS is the sum
 * of those `.js` files, gzipped, the same sum `next build` prints in its "First Load JS" column (to within a kB: Next
 * rounds, this does not). Lighthouse covers four public pages; this covers the signed-in app, which it cannot reach.
 *
 * Budgets are in kB (1000 bytes), gzipped. A route over its line fails the job with the route and both sizes. A route
 * in the budget that the build no longer has fails too: a rename must move its line, not drop the check.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

type Budget = { routes: Record<string, number> };

const root = path.resolve(import.meta.dirname, "..");
const distDir = path.join(root, process.env.OPENCMO_E2E_BUILD === "1" ? ".next-e2e" : ".next");
const printOnly = process.argv.includes("--print");

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    console.error(`bundle-budget: cannot read ${path.relative(root, file)} (${(e as Error).message}). Run \`npm run build\` first.`);
    process.exit(2);
  }
}

const manifest = readJson<{ pages: Record<string, string[]> }>(path.join(distDir, "app-build-manifest.json"));
const budget = readJson<Budget>(path.join(root, "bundle-budget.json"));

const gzipped = new Map<string, number>();
function sizeOf(file: string): number {
  let n = gzipped.get(file);
  if (n === undefined) {
    n = gzipSync(readFileSync(path.join(distDir, file))).length;
    gzipped.set(file, n);
  }
  return n;
}

/** `/` → `/page`, `/app/writer` → `/app/writer/page`: the manifest's key for a route's page. */
const pageKey = (route: string) => (route === "/" ? "/page" : `${route}/page`);

function firstLoadKb(route: string): number | null {
  const files = manifest.pages[pageKey(route)];
  if (!files) return null;
  const bytes = [...new Set(files)].filter((f) => f.endsWith(".js")).reduce((sum, f) => sum + sizeOf(f), 0);
  return Math.round(bytes / 100) / 10;
}

const failures: string[] = [];
for (const [route, limit] of Object.entries(budget.routes)) {
  const kb = firstLoadKb(route);
  if (kb === null) {
    failures.push(`${route}: not in the build (renamed? move its line in bundle-budget.json)`);
    console.log(`FAIL ${route.padEnd(24)} missing`);
    continue;
  }
  const over = !printOnly && kb > limit;
  console.log(`${over ? "FAIL" : "ok  "} ${route.padEnd(24)} ${kb.toFixed(1).padStart(6)} kB${printOnly ? "" : ` / ${limit} kB`}`);
  if (over) failures.push(`${route}: ${kb.toFixed(1)} kB of first-load JS, budget ${limit} kB`);
}

if (failures.length && !printOnly) {
  console.error(
    `\nbundle-budget: ${failures.join("; ")}.\n` +
      "Find what grew with the build's \"First Load JS\" column; raise a line in bundle-budget.json only with the reason in the PR.",
  );
  process.exit(1);
}
