/**
 * Step limits per CMO job, from the capability registry (`packages/contracts/capabilities.json`, brain.md §7;
 * cmo-review B3.3). Until now `max_steps` was only drift-checked; the job runner now stops a run that takes more
 * steps than its kind allows, so a loop in a job fails (and is refunded) instead of running and charging on.
 *
 * Pure: `jobs.check.ts` runs every job under these limits.
 */

import data from "../../../../packages/contracts/capabilities.json";

const LIMITS: ReadonlyMap<string, number> = new Map(
  (data.capabilities as { name: string; order_kind: string | null; max_steps: number }[])
    .filter((c) => c.order_kind === c.name)
    .map((c) => [c.name, c.max_steps]),
);

/** The most steps a run of this kind may take; null for a kind the registry does not list (not limited here). */
export function maxSteps(kind: string): number | null {
  return LIMITS.get(kind) ?? null;
}
