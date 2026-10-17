import "server-only";

/**
 * Reads the user's website for W0 Onboarding (tool `fetch_site`) and the CMO's `read_site`.
 *
 * Fetching a URL the user typed is the classic SSRF door: 169.254.169.254, localhost, the private
 * network. So, on every hop (redirects included, at most 3):
 * - `checkUrl` (lib/net/address.ts): http/https, ports 80/443, no user:pass, no private literal
 *   address or never-public name;
 * - resolve DNS once and refuse unless every answer is public;
 * - connect to exactly the address that passed (a pinned `lookup`), so a DNS-rebinding answer
 *   between check and connect cannot steer us inward. Over MCP the page text goes back to the
 *   caller, so "nothing is returned" no longer holds;
 * - time and size caps per page.
 */

import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

import { cleanUntrusted } from "@/lib/cmo/untrusted";
import { blockedName, checkUrl, privateAddress, refused } from "@/lib/net/address";

export { privateAddress };

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const TEXT_PER_PAGE = 8000;
/** Sub-pages worth reading: pricing, about, features. */
const EXTRA_PAGE = /\/(pricing|plans|about|features|product|how-it-works)\/?$/i;

export class SiteError extends Error {}

export type SitePage = { url: string; title: string; description: string; headings: string[]; text: string };
export type SiteSnapshot = { url: string; pages: SitePage[] };
/** `port` is for tests only (a local server cannot listen on 80); `publicAddresses` never sets it. */
export type Resolved = { address: string; family: number; port?: number };
/** Host → the addresses we may connect to; throws SiteError when any answer is private. */
export type Resolver = (host: string) => Promise<Resolved[]>;

const NOT_PUBLIC = "Enter a public website address.";

/** Normalizes the "Your website" field: adds https://, drops the path, refuses anything but a public domain. */
export function normalizeSite(input: string): URL {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SiteError("Enter a website address like yourcompany.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SiteError("Use an http or https address.");
  if (url.username || url.password || url.port) throw new SiteError("Enter just the website address.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || refused(checkUrl(url)) || blockedName(host)) throw new SiteError(NOT_PUBLIC);
  return new URL(`${url.protocol}//${host}/`);
}

/** The syntax half of each hop: scheme, port, userinfo, literal address, never-public name. */
export function checkHop(url: URL): { host: string; port: number } {
  const result = checkUrl(url);
  if (refused(result)) {
    throw new SiteError(result.refused === "scheme" ? "That website redirects somewhere we can't read." : NOT_PUBLIC);
  }
  return result;
}

/** DNS once, every answer public. A public literal address needs no DNS. */
export const publicAddresses: Resolver = async (host) => {
  const family = isIP(host);
  if (family) return [{ address: host, family }];
  let addresses: Resolved[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SiteError("We could not find that website. Check the address.");
  }
  if (addresses.length === 0 || addresses.some((a) => privateAddress(a.address))) throw new SiteError(NOT_PUBLIC);
  return addresses;
};

/** A `lookup` that answers only with the addresses that passed the check. */
function pinned(addresses: Resolved[]): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, addresses.map(({ address, family }) => ({ address, family })));
    else callback(null, addresses[0].address, addresses[0].family);
  };
}

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: Readable };

function get(url: URL, addresses: Resolved[]): Promise<Answer> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, {
      ...(addresses[0].port ? { port: addresses[0].port } : {}),
      lookup: pinned(addresses),
      // A pinned lookup is per request; a pooled socket could belong to another host's answer.
      agent: false,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "OpenCMOBot/1.0 (+https://opencmo.io)", accept: "text/html,application/xhtml+xml" },
    });
    request.on("response", (response) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response }));
    request.on("error", reject);
  });
}

async function readCapped(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BYTES) {
      body.destroy();
      break;
    }
    chunks.push(chunk as Buffer);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

/** Fetches one HTML page, following redirects and checking every hop. Null when it is not HTML. */
export async function fetchPage(start: URL, resolve: Resolver = publicAddresses): Promise<{ url: URL; html: string } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { host } = checkHop(url);
    const addresses = await resolve(host);
    let response: Answer;
    try {
      response = await get(url, addresses);
    } catch {
      throw new SiteError("We could not reach that website. Check the address and try again.");
    }
    if (response.status >= 300 && response.status < 400) {
      response.body.resume();
      const next = response.headers.location;
      if (!next) break;
      url = new URL(next, url);
      continue;
    }
    if (response.status < 200 || response.status >= 300 || !(response.headers["content-type"] ?? "").includes("html")) {
      response.body.resume();
      return null;
    }
    try {
      return { url, html: await readCapped(response.body) };
    } catch {
      throw new SiteError("We could not reach that website. Check the address and try again.");
    }
  }
  throw new SiteError("That website redirects too many times.");
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

const clean = (s: string) => cleanUntrusted(decode(s.replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();

/** Inline styles and attributes that hide an element from a visitor (but not from a text extractor). */
const HIDDEN = new RegExp(
  [
    String.raw`\shidden(?=[\s=/]|$)`,
    String.raw`\saria-hidden\s*=\s*["']?true`,
    String.raw`display\s*:\s*none`,
    String.raw`visibility\s*:\s*hidden`,
    String.raw`font-size\s*:\s*0(?:\.0+)?(?:px|em|rem|pt|%)?\s*(?:[;"'!]|$)`,
    String.raw`opacity\s*:\s*0(?:\.0+)?\s*(?:[;"'!]|$)`,
  ].join("|"),
  "i",
);
const VOID = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * Removes elements a visitor never sees: a page can hide instructions for an AI reader in them
 * (security plan fix 10). Nested elements of the same name are matched, so the whole hidden
 * subtree goes, not just up to the first closing tag.
 */
function dropHidden(html: string): string {
  const open = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let out = "";
  let from = 0;
  for (let match = open.exec(html); match; match = open.exec(html)) {
    const name = match[1].toLowerCase();
    if (!HIDDEN.test(match[2])) continue;
    out += html.slice(from, match.index);
    let end = open.lastIndex;
    if (!VOID.has(name) && !match[2].trimEnd().endsWith("/")) {
      const tags = new RegExp(`<(/?)${name}\\b[^>]*>`, "gi");
      tags.lastIndex = end;
      let depth = 1;
      for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0) {
          end = tags.lastIndex;
          break;
        }
      }
      if (depth !== 0) end = html.length;
    }
    from = end;
    open.lastIndex = end;
  }
  return out + html.slice(from);
}

/** Readable text from HTML: title, description, headings, body (no script/style/nav, nothing hidden). */
export function extractPage(url: string, html: string): SitePage {
  const body = dropHidden(
    html
      .replace(/<(script|style|noscript|svg|template|iframe|textarea)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " "),
  );
  const title = clean(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = clean(
    body.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      body.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
      "",
  );
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])).filter(Boolean).slice(0, 30);
  const text = clean(body.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, " ")).slice(0, TEXT_PER_PAGE);
  return { url, title: title.slice(0, 200), description: description.slice(0, 400), headings, text };
}

function extraLinks(base: URL, html: string): URL[] {
  const seen = new Set<string>();
  const out: URL[] = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    let link: URL;
    try {
      link = new URL(match[1], base);
    } catch {
      continue;
    }
    if (link.hostname !== base.hostname || !EXTRA_PAGE.test(link.pathname)) continue;
    const key = link.pathname.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(new URL(link.pathname, base));
    if (out.length === 3) break;
  }
  return out;
}

/** Home page plus up to 3 same-site sub-pages. An unreadable home page is the user's error to fix. */
export async function readSite(input: string, resolve: Resolver = publicAddresses): Promise<SiteSnapshot> {
  const home = await fetchPage(normalizeSite(input), resolve);
  if (!home) throw new SiteError("We could not read that website. Is it public?");
  const pages = [extractPage(home.url.toString(), home.html)];
  const extras = await Promise.all(
    extraLinks(home.url, home.html).map((link) => fetchPage(link, resolve).catch(() => null)),
  );
  for (const page of extras) if (page) pages.push(extractPage(page.url.toString(), page.html));
  if (pages.every((p) => p.text.length < 80 && !p.description)) {
    throw new SiteError("That website has almost no text we can read. Try your main marketing site.");
  }
  return { url: home.url.toString(), pages };
}
