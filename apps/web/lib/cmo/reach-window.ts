/**
 * The DM window, in a module with no zod: the Sales page's first load reads it (`sales-card.ts`) while `reach.ts`,
 * which defines the schema, loads only with the reach panel (JS budget of /app/sales).
 */

/** A thread counts as fresh for a DM when it was posted less than this long ago (owner, 2026-11-24: 14 days). */
export const FRESH_DAYS = 14;
