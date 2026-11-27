/**
 * The X News snapshot's limits from env, in a module of their own so the Costs page (`lib/ops/switches.ts`) shows the
 * same numbers the snapshot uses without importing the model client.
 */

const DEFAULT_MAX_CALLS = 10;
/**
 * X has not published a price for News (2026-11-27). Until it does, the estimate assumes News bills like a post read,
 * per story returned; `X_NEWS_PRICE` (US dollars per story) replaces the assumption.
 */
const DEFAULT_PRICE_PER_STORY = 0.005;

/** The calls one snapshot may send: `X_NEWS_MAX_CALLS`, 10 by default, never more than 50. */
export function maxCalls(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.X_NEWS_MAX_CALLS);
  return Number.isFinite(n) && n >= 1 ? Math.min(50, Math.floor(n)) : DEFAULT_MAX_CALLS;
}

/** Dollars per story returned: `X_NEWS_PRICE`, else the assumption above. */
export function pricePerStory(env: Record<string, string | undefined> = process.env): number {
  const raw = env.X_NEWS_PRICE?.trim() ?? "";
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICE_PER_STORY;
}
