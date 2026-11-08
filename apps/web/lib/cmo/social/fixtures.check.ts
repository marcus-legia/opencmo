/**
 * Every ScrapeCreators reader on a saved answer (cmo-review-2 S3.4). `fixtures/scrapecreators/<name>.json` is either
 * `real` (saved by scripts/scrapecreators-fixtures.mts with the real key, then redacted) or `assumed` (written from the
 * paths the parsers read, until the owner runs that script). No network: `fetch` answers from the fixture.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ENDPOINTS, type Fixture, type Found } from "./fixtures/endpoints";

const DIR = path.join(import.meta.dirname, "fixtures/scrapecreators");

async function main() {
  const realFetch = globalThis.fetch;
  process.env.SCRAPECREATORS_API_KEY = "sc-test";
  delete process.env.OPENCMO_AGENT_FAKE;
  const counts = { real: 0, assumed: 0 };
  try {
    for (const endpoint of ENDPOINTS) {
      const fixture = JSON.parse(await readFile(path.join(DIR, `${endpoint.name}.json`), "utf8")) as Fixture;
      assert.equal(fixture.path, endpoint.path, `${endpoint.name}: the fixture is for ${endpoint.path}`);
      counts[fixture.source] += 1;
      const seen: string[] = [];
      globalThis.fetch = (async (input: string) => {
        seen.push(new URL(input).pathname);
        return new Response(JSON.stringify(fixture.body), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      // The fixture's own params, so a link-fed call reads the link it was saved with.
      const found: Found = { redditThread: fixture.params.url, tweet: fixture.params.url, youtubeVideo: fixture.params.url, tiktokVideo: fixture.params.url, instagramPost: fixture.params.url, xVideo: fixture.params.url };
      const params = endpoint.params(found) ?? fixture.params;
      const result = await endpoint.read(params);
      assert.deepEqual(seen, [endpoint.path], `${endpoint.name}: one call, to its endpoint`);
      endpoint.expect(result);
    }
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SCRAPECREATORS_API_KEY;
  }
  console.log(`scrapecreators fixtures: ok (${counts.real} real, ${counts.assumed} assumed${counts.assumed ? ": run scripts/scrapecreators-fixtures.mts with the real key" : ""})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
