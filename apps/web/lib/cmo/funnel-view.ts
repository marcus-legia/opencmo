/**
 * The funnel as the screens show it (wave 3, C6): found → replied → answered back → signed up, from `my_funnel`.
 * Pure: the browser imports it too.
 */
export const FUNNEL_SOURCES = ["all", "reddit", "hn", "facebook", "threads"] as const;
export type FunnelSource = (typeof FUNNEL_SOURCES)[number];
export type FunnelRow = { source: FunnelSource; found: number; replied: number; answeredBack: number; signedUp: number };

/** "34% of found"; null when there is nothing to divide by, so the screen never shows a made-up rate. */
export function rate(part: number, whole: number): string | null {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : null;
}

/** How often Sales scans on its own (wave 3, A5's `sales_settings.cadence`): Monday, Wednesday and Friday by default. */
export const SCAN_CADENCES = ["mwf", "weekdays", "monday"] as const;
export type Cadence = (typeof SCAN_CADENCES)[number];
export const CADENCE_LABEL: Record<Cadence, string> = {
  mwf: "Monday, Wednesday and Friday",
  weekdays: "Every weekday",
  monday: "Mondays only",
};
