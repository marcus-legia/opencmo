/**
 * Saves one real ScrapeCreators answer per endpoint as a fixture (cmo-review-2 S3.4). The owner runs it once, with the
 * real key; nothing here goes into the repo but the redacted bodies.
 *
 *   cd apps/web
 *   SCRAPECREATORS_API_KEY=… npx tsx scripts/scrapecreators-fixtures.mts \
 *     [--instagram=https://www.instagram.com/reel/…] [--x-video=https://x.com/…/status/…]
 *
 * About 15 calls (a few cents). Each call goes through the same reader the app uses (`lib/cmo/social/research.ts`),
 * so a body that reader cannot parse is reported here at once. The Instagram and X transcripts need a public video
 * link: pass one, or they are skipped. Then run `npx tsx lib/cmo/social/fixtures.check.ts` and commit the fixtures.
 *
 * Redaction: user names, display names, ids of people, avatars and emails become placeholders, everywhere they appear
 * (also inside links and text), lists keep 3 items, and long strings are cut. The structure, the keys and the numbers
 * stay: that is what the parsers read.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ENDPOINTS, type Fixture, type Found } from "../lib/cmo/social/fixtures/endpoints";

const OUT = path.resolve(import.meta.dirname, "../lib/cmo/social/fixtures/scrapecreators");
const PLACEHOLDER = "user_redacted";
const PERSON_KEYS = /^(author|username|user_name|screen_name|unique_id|uniqueId|nickname|name|display_name|full_name|handle|channelTitle|owner|email|sec_uid|uid|user_id|author_id|author_fullname|creator)$/i;
const AVATAR_KEYS = /(avatar|profile_pic|profile_image|profile_banner|icon_img|thumbnail_url_hd)/i;

if (!process.env.SCRAPECREATORS_API_KEY && !process.env.SCRAPE_CREATORS_API_KEY) {
  console.error("Set SCRAPECREATORS_API_KEY first.");
  process.exit(1);
}
delete process.env.OPENCMO_AGENT_FAKE;

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=", 2) as [string, string]));

/** Names found in a body: replaced wherever they appear, so a link does not carry them either. */
function collectNames(value: unknown, names: Set<string>, key = ""): void {
  if (typeof value === "string" && PERSON_KEYS.test(key) && value.length >= 3 && value.length <= 80) names.add(value.replace(/^@|^u\//, ""));
  else if (Array.isArray(value)) value.forEach((item) => collectNames(item, names, key));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collectNames(v, names, k);
}

function redact(value: unknown, names: string[], key = ""): unknown {
  if (typeof value === "string") {
    if (AVATAR_KEYS.test(key)) return "https://example.invalid/avatar.jpg";
    if (/@[a-z0-9-]+\.[a-z]{2,}/i.test(value) && /email/i.test(key)) return "redacted@example.invalid";
    let out = value;
    for (const name of names) out = out.split(name).join(PLACEHOLDER);
    return out.length > 600 ? `${out.slice(0, 600)}…` : out;
  }
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => redact(item, names, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, names, k)]));
  return value;
}

// Every body the reader fetches, by path: the reader parses it, this keeps a copy.
const bodies = new Map<string, unknown>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input, init);
  const url = new URL(String(input));
  const copy = await response.clone().json().catch(() => null);
  bodies.set(url.pathname, copy);
  return response;
}) as typeof fetch;

const found: Found = { instagramPost: args.instagram, xVideo: args["x-video"] };
await mkdir(OUT, { recursive: true });
let failed = 0;
// `--only=facebook,threads`: capture only the endpoints whose name contains one of these words (new readers, without
// paying again for the ones already saved).
const only = args.only ? args.only.split(",").filter(Boolean) : [];
for (const endpoint of ENDPOINTS) {
  if (only.length && !only.some((word) => endpoint.name.includes(word))) continue;
  const params = endpoint.params(found);
  if (!params) {
    console.log(`skip  ${endpoint.name}: no input link (see the header of this script)`);
    continue;
  }
  bodies.delete(endpoint.path);
  let result: unknown;
  try {
    result = await endpoint.read(params);
    endpoint.find?.(result, found);
    endpoint.expect(result);
    console.log(`ok    ${endpoint.name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${endpoint.name}: ${error instanceof Error ? error.message : error}`);
  }
  const body = bodies.get(endpoint.path);
  if (body === undefined) continue;
  const names = new Set<string>();
  collectNames(body, names);
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const fixture: Fixture = {
    source: "real",
    path: endpoint.path,
    params: redact(params, sorted) as Record<string, string>,
    capturedAt: new Date().toISOString().slice(0, 10),
    body: redact(body, sorted),
  };
  await writeFile(path.join(OUT, `${endpoint.name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
globalThis.fetch = realFetch;
console.log(failed ? `\n${failed} endpoint(s) failed: if the provider answered, fix the parser in lib/cmo/social/scrapecreators.ts, then run the check.` : "\nAll saved. Run: npx tsx lib/cmo/social/fixtures.check.ts");
process.exit(failed ? 1 : 0);
