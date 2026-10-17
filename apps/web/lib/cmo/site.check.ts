/**
 * The SSRF guard of `readSite` / `fetchPage`, against a real local HTTP server.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/site.check.ts
 *
 * `site.example` has no DNS; the test resolver pins it to the local server, so a page that loads
 * proves the connection went to the checked address, not to a second lookup. Every redirect hop
 * must pass the same checks as the first: port, userinfo, private literal, never-public name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { checkHop, fetchPage, publicAddresses, type Resolver, SiteError } from "./site";

type Case = { input: string; blocked: boolean; why: string };
const CASES: Case[] = JSON.parse(
  readFileSync(new URL("../../../../packages/contracts/private-addresses.json", import.meta.url), "utf8"),
);

const failures: string[] = [];
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  for (const { input, blocked, why } of CASES) {
    await check(`hop ${input} (${why})`, async () => {
      const url = new URL(`https://${input}/`);
      if (blocked) {
        assert.throws(() => checkHop(url), SiteError);
      } else {
        assert.doesNotThrow(() => checkHop(url));
      }
      // A literal public address needs no DNS; a private one never reaches the resolver.
      if (!blocked && /^[\d.[\]:a-f]+$/.test(input)) assert.ok((await publicAddresses(checkHop(url).host)).length > 0);
    });
  }

  const seen: IncomingMessage[] = [];
  const server = createServer((req, res) => {
    seen.push(req);
    const to: Record<string, string> = {
      "/private": "http://127.0.0.1/",
      "/mapped": "http://[::ffff:7f00:1]/",
      "/port": "http://site.example:6379/",
      "/userinfo": "http://user:pw@site.example/",
      "/metadata": "http://metadata.google.internal/computeMetadata/v1/",
      "/decimal": "http://2130706433/",
      "/ok": "/",
    };
    if (req.url && to[req.url]) {
      res.writeHead(302, { location: to[req.url] }).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end("<title>Local</title><p>pinned</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const resolve: Resolver = async (host) =>
    host === "site.example" ? [{ address: "127.0.0.1", family: 4, port }] : publicAddresses(host);

  await check("the connection goes to the pinned address", async () => {
    const page = await fetchPage(new URL("http://site.example/"), resolve);
    assert.ok(page?.html.includes("pinned"));
    assert.equal(seen.at(-1)?.headers.host?.split(":")[0], "site.example");
  });

  await check("a same-site redirect is followed", async () => {
    const page = await fetchPage(new URL("http://site.example/ok"), resolve);
    assert.equal(page?.url.toString(), "http://site.example/");
  });

  for (const path of ["/private", "/mapped", "/port", "/userinfo", "/metadata", "/decimal"]) {
    await check(`redirect hop ${path} is refused`, async () => {
      const before = seen.length;
      await assert.rejects(fetchPage(new URL(`http://site.example${path}`), resolve), SiteError);
      assert.equal(seen.length, before + 1, "only the first hop reached a server");
    });
  }

  await check("the real resolver refuses a name that resolves to loopback", async () => {
    await assert.rejects(publicAddresses("localhost"), SiteError);
  });

  server.close();
  if (failures.length > 0) {
    console.error(`${failures.length} checks failed:`);
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log("site: every hop is checked and pinned");
}

void main();
