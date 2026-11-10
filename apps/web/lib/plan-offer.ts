/** One plan as `PlanSheet` shows it (`GET /api/v1/billing/plans`). Only plans with a catalogue row, so every number comes from `billing_catalog`. */
export type PlanOffer = {
  slug: string;
  name: string;
  /** Per month; an annual plan's billed price is `billedPrice`. */
  price: number;
  billedPrice: number;
  listPrice: number | null;
  interval: "month" | "year";
  credits: number;
  highlight: boolean;
};

/** The code `cmo_require_paid` puts in a 402's detail (`lib/api/errors.ts` maps SQLSTATE P0402 to it). */
export const PLAN_REQUIRED = "plan_required";

/**
 * True for the API's answer to an action that needs a plan: HTTP 402 with `detail.code = "plan_required"`. Callers
 * show `PlanSheet` for it instead of an error line. Works on the client `ApiError` and on any `{ status, detail }`.
 */
export function isPlanRequired(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, detail } = error as { status?: unknown; detail?: unknown };
  if (status !== 402 || !detail || typeof detail !== "object") return false;
  return (detail as { code?: unknown }).code === PLAN_REQUIRED;
}
