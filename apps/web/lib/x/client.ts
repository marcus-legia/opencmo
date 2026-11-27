/**
 * X News, read with Ferreto's own app-only bearer token (plan 2026-11-27-content-plan-and-x-news.md, Part B2).
 *
 * One endpoint and nothing else from X (owner decision 8): `GET /2/news/search`. The token carries no user context, so
 * a snapshot serves every founder. Seen with the owner's key on 2026-11-27: the search is fuzzy and never comes back
 * empty, `keywords` was null, and the limit was 200 calls per 15 minutes.
 *
 * A failed call (no key, a 429, a 5xx, a timeout, a body that does not parse) is logged and gives no stories: one
 * failed query never fails the snapshot. Everything a story says is a stranger's text (Grok writes it from posts), so
 * it is cleaned and cut here, and wrapped as data wherever it reaches a prompt.
 *
 * Not `server-only` so checks can run it; the key is read from the server's env only.
 */

import { agentFakeAllowed } from "@/lib/production";

import { cleanUntrusted } from "../cmo/untrusted";
import recorded from "./fixtures/news-search.json";

export const X_API_BASE = "https://api.x.com/2";
const TIMEOUT_MS = 15_000;
const NEWS_FIELDS = "name,summary,hook,category,keywords,cluster_posts_results,updated_at";

/** One X News story, cleaned and cut to the lengths `x_news_stories` stores. */
export type NewsStory = {
  storyId: string;
  name: string;
  summary: string;
  hook: string;
  category: string;
  postIds: string[];
  updatedAt: string | null;
};

/** What one search did: the stories, and whether a request was sent (and so may be billed). */
export type NewsSearch = { stories: NewsStory[]; called: boolean; status: number | null };

export const xNewsFakeAllowed = agentFakeAllowed;

const xKey = (): string => process.env.X_BEARER_TOKEN?.trim() ?? "";

/** True when a snapshot can reach X: a key, or the fake outside production. */
export const xNewsReady = (): boolean => Boolean(xKey()) || xNewsFakeAllowed();

const ID = /^[0-9]{1,19}$/;

/**
 * Outside text as one plain line, at most `max` characters. Cut by code point, as Postgres counts `char_length`: a
 * UTF-16 cut can leave half an emoji, a lone surrogate Postgres refuses, and the whole snapshot insert would fail.
 */
export function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return Array.from(cleanUntrusted(value).replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
}

/** The `data` of a News search response as stories; a story with no id or no name is dropped. */
export function parseNewsSearch(body: unknown): NewsStory[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: NewsStory[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const storyId = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : null;
    const name = plain(raw.name, 120);
    if (!storyId || !name) continue;
    const cluster = Array.isArray(raw.cluster_posts_results) ? (raw.cluster_posts_results as { post_id?: unknown }[]) : [];
    const postIds = [...new Set(cluster.map((p) => p?.post_id).filter((id): id is string => typeof id === "string" && ID.test(id)))].slice(0, 10);
    const updated = typeof raw.updated_at === "string" && !Number.isNaN(Date.parse(raw.updated_at)) ? new Date(raw.updated_at).toISOString() : null;
    out.push({
      storyId,
      name,
      summary: plain(raw.summary, 1000),
      hook: plain(raw.hook, 400),
      category: plain(raw.category, 60),
      postIds,
      updatedAt: updated,
    });
  }
  return out;
}

/** The fake: the recorded stories, whatever the query (the real search never comes back empty either). */
function fakeSearch(max: number): NewsSearch {
  return { stories: parseNewsSearch(recorded).slice(0, max), called: false, status: null };
}

export type SearchNewsOptions = { maxAgeHours?: number; max?: number; fetchImpl?: typeof fetch };

/**
 * `GET /2/news/search` for `query`: stories updated in the last `maxAgeHours` (1–720, 24 by default), at most `max`
 * (1–100, 20 by default). Never throws.
 */
export async function searchNews(query: string, opts: SearchNewsOptions = {}): Promise<NewsSearch> {
  const max = Math.min(100, Math.max(1, Math.round(opts.max ?? 20)));
  const maxAgeHours = Math.min(720, Math.max(1, Math.round(opts.maxAgeHours ?? 24)));
  const q = query.trim().slice(0, 2048);
  if (!q) return { stories: [], called: false, status: null };
  const key = xKey();
  if (!key) {
    if (xNewsFakeAllowed()) return fakeSearch(max);
    console.warn("[x-news] X_BEARER_TOKEN is not set: no stories");
    return { stories: [], called: false, status: null };
  }
  const url = `${X_API_BASE}/news/search?${new URLSearchParams({
    query: q,
    max_age_hours: String(maxAgeHours),
    max_results: String(max),
    "news.fields": NEWS_FIELDS,
  })}`;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) {
      // The status only: X's error body can echo the request, and the request carries the key in a header, not here.
      console.warn(`[x-news] search "${q.slice(0, 60)}" failed: HTTP ${response.status}`);
      return { stories: [], called: true, status: response.status };
    }
    return { stories: parseNewsSearch(await response.json()), called: true, status: response.status };
  } catch (error) {
    console.warn(`[x-news] search "${q.slice(0, 60)}" failed:`, error instanceof Error ? error.name : "error");
    return { stories: [], called: true, status: null };
  }
}
