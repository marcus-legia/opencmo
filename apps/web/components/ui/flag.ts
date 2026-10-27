/**
 * The redesigned app (docs/plans/cmo/2026-10-27-ui-build-plan.md) ships behind this flag. Production leaves it unset
 * until release, so with it off the app is exactly today's.
 */
export const UI_V2 = process.env.NEXT_PUBLIC_OPENCMO_UI === "v2";
