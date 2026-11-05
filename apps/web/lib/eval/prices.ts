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
];
const DEAREST: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceOf(model: string): Price {
  const name = model.toLowerCase();
  for (const [prefix, price] of PRICES) if (name.startsWith(prefix)) return price;
  return DEAREST;
}

export function usageUsd(usage: LlmUsage): number {
  const price = priceOf(usage.model);
  return (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) / 1e6;
}
