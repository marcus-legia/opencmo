/**
 * Smoke test of a deployed site (web hardening round 3, item 2). Run by `.github/workflows/post-deploy.yml` after each
 * production deploy, and by hand:
 *
 *   SMOKE_URL=https://ferreto.io npx tsx apps/web/scripts/smoke-production.mts
 *
 * GET only, no cookie, no sign-in, no account: what any visitor can read. It checks what CI cannot, because CI builds
 * the PR's code on a local stack and never sees the deploy's env: the database answers, the catalogue reaches the
 * pricing section, the public pages and their security headers are served, and the Sentry DSN inlined in the client
 * bundle parses (round 2 found a cut-off one a week late, from the dashboard being quiet).
 *
 * Env:
 *   SMOKE_URL            the site, e.g. the production domain (required).
 *   SMOKE_EXPECT_COMMIT  the deploy's commit (full, or a prefix of 7 or more). On Vercel every response carries the
 *                        commit it was built from (`X-Deploy-Commit`, next.config.ts), so the script waits up to 5
 *                        minutes for the domain to serve this deploy before checking it. Without it, it waits for
 *                        `/api/health` to answer 200 for up to 2 minutes instead. A redeploy of the same commit cannot
 *                        be told from the deploy it replaces this way, so such a run may check the old one.
 *   SMOKE_SENTRY         `required` (default) or `optional`: a local build has no DSN, production must.
 */
import { readSentryDsn } from "../lib/ops/sentry-dsn";

const base = (process.env.SMOKE_URL ?? "").trim().replace(/\/+$/, "");
const expectCommit = (process.env.SMOKE_EXPECT_COMMIT ?? "").trim().toLowerCase();
const sentryRequired = (process.env.SMOKE_SENTRY ?? "required") !== "optional";
const TIMEOUT_MS = 15_000;
const UA = "opencmo-smoke/1";

if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error("SMOKE_URL must be an origin like https://example.com (no path).");
  process.exit(2);
}
if (expectCommit && !/^[0-9a-f]{7,40}$/.test(expectCommit)) {
  console.error("SMOKE_EXPECT_COMMIT must be a commit id (7 to 40 hex characters).");
  process.exit(2);
}

const failures: string[] = [];
function check(ok: boolean, what: string, detail = ""): boolean {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
  return ok;
}

async function get(path: string): Promise<{ status: number; headers: Headers; body: string } | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "user-agent": UA, "cache-control": "no-cache" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, headers: res.headers, body: await res.text() };
  } catch (e) {
    console.log(`     ${path}: ${(e as Error).name}`);
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForDeploy(): Promise<void> {
  if (expectCommit) {
    const deadline = Date.now() + 5 * 60_000;
    let seen: string | null = null;
    while (Date.now() < deadline) {
      const health = await get("/api/health");
      seen = health?.headers.get("x-deploy-commit") ?? null;
      if (seen?.startsWith(expectCommit)) break;
      await sleep(10_000);
    }
    check(!!seen?.startsWith(expectCommit), "the domain serves this deploy", `commit ${seen ?? "unknown"}, expected ${expectCommit}`);
    return;
  }
  // No commit to compare: the site gets two minutes to come up, then is checked as it is.
  const deadline = Date.now() + 2 * 60_000;
  while (Date.now() < deadline) {
    const health = await get("/api/health");
    if (health?.status === 200) return;
    await sleep(10_000);
  }
}

function headerChecks(path: string, headers: Headers): void {
  const csp = headers.get("content-security-policy") ?? "";
  check(
    csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'") && !csp.includes("'unsafe-eval'"),
    `${path}: Content-Security-Policy`,
    csp ? "" : "missing",
  );
  const maxAge = Number(/max-age=(\d+)/.exec(headers.get("strict-transport-security") ?? "")?.[1] ?? 0);
  check(maxAge >= 31_536_000, `${path}: Strict-Transport-Security, max-age of a year or more`, `max-age=${maxAge}`);
}

/** Same-origin script chunks a page loads; nothing from another host is fetched. */
function chunksOf(html: string): string[] {
  const out = new Set<string>();
  // A chunk may carry a query (Vercel's Skew Protection adds `?dpl=…`): keep it, so the chunk of this deploy is read.
  for (const m of html.matchAll(/<script[^>]+src="(\/_next\/static\/[\w\-./~]+\.js(?:\?[^"]*)?)"/g)) {
    out.add(m[1]!.replaceAll("&amp;", "&"));
  }
  return [...out];
}

/** A Sentry DSN as the SDK sees it: a URL with a public key as the user. Cut-off values still match, on purpose. */
const DSN_IN_BUNDLE = /https?:\/\/\w{16,}@[\w.-]+(?::\d+)?[\w/]*/g;

async function sentryCheck(html: string): Promise<void> {
  const chunks = chunksOf(html);
  const loaded = await Promise.all(chunks.map((chunk) => get(chunk)));
  // A chunk that did not load is its own failure, not "no DSN": otherwise a timeout reads as Sentry being off.
  const missing = chunks.filter((_, i) => loaded[i]?.status !== 200);
  check(missing.length === 0, "/: every script chunk loads", missing.length ? `${missing.length} of ${chunks.length} failed` : "");
  const found = new Set<string>();
  for (const res of loaded) for (const m of res?.body.matchAll(DSN_IN_BUNDLE) ?? []) found.add(m[0]);
  if (found.size === 0) {
    check(!sentryRequired, "Sentry DSN in the client bundle", "none found: Sentry is off for browsers");
    return;
  }
  for (const dsn of found) {
    // The DSN is public (it ships to every browser), but the log names only its host.
    const host = /@([\w.-]+)/.exec(dsn)?.[1] ?? "?";
    check(readSentryDsn(dsn).state === "ok", "Sentry DSN in the client bundle parses", `host ${host}`);
  }
}

async function main() {
  console.log(`smoke: ${base}${expectCommit ? `, commit ${expectCommit}` : ""}`);
  await waitForDeploy();

  const health = await get("/api/health");
  let healthOk = false;
  try {
    healthOk = health?.status === 200 && (JSON.parse(health.body) as { ok?: unknown }).ok === true;
  } catch {
    // Not JSON: reported below.
  }
  check(healthOk, "/api/health: 200 with ok: true", health ? `${health.status} ${health.body.slice(0, 200)}` : "no answer");

  const home = await get("/");
  if (check(home?.status === 200, "/: 200", String(home?.status ?? "no answer")) && home) {
    // The offer box is drawn only from a catalogue row (app/page.tsx); without one the section says "after you sign
    // in" and shows no price. The stack-comparison prices beside it are hard-coded, so they do not count.
    const offer = /class="lv-offer-price"[\s\S]{0,400}?<strong>\$(?:<!-- -->)?(\d+(?:\.\d+)?)<\/strong>/.exec(home.body);
    check(home.body.includes('id="pricing"') && !!offer, "/: pricing section shows a catalogue price", offer ? `$${offer[1]}` : "no offer price");
    headerChecks("/", home.headers);
    await sentryCheck(home.body);
  }

  for (const path of ["/login", "/blog", "/sitemap.xml", "/robots.txt"]) {
    const res = await get(path);
    check(res?.status === 200, `${path}: 200`, String(res?.status ?? "no answer"));
    if (path === "/login" && res) headerChecks(path, res.headers);
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

await main();
