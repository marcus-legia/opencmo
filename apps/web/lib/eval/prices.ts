/**
 * USD per million tokens by model, for eval cost reports and the `--max-usd` cap only (users are
 * charged from `agent_model_prices` in SQL; keep the two in step). First matching prefix wins; an
 * unknown model is priced like the dearest one so a cap never under-counts.
 */

import type { LlmUsage } from "@/lib/cmo/jobs/llm";

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const PRICES: [prefix: string, price: Price][] = [
  ["claude-opus-5", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-sonnet-5", { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }],
  ["claude-haiku-5", { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  ["claude-haiku-4", { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
  ["gemini-flash", { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 }],
  ["gemini-pro", { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 }],
];
const DEAREST: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceOf(model: string): Price {
  const name = model.toLowerCase();
  for (const [prefix, price] of PRICES) if (name.startsWith(prefix)) return price;
  // Versioned Gemini names ("gemini-3.1-flash-…", "gemini-pro-latest") put the tier mid-name.
  if (name.startsWith("gemini-")) return name.includes("flash") ? PRICES[4]![1] : PRICES[5]![1];
  return DEAREST;
}

export function usageUsd(usage: LlmUsage): number {
  const price = priceOf(usage.model);
  return (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) / 1e6;
}
