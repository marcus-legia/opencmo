import { notFound } from "next/navigation";

/**
 * The redesign ships behind `NEXT_PUBLIC_OPENCMO_UI=v2` (ui-build plan §1). It is a build-time
 * value: with it unset the new routes do not exist, so a link or a guess cannot reach sample data.
 */
export const UI_V2 = process.env.NEXT_PUBLIC_OPENCMO_UI === "v2";

/** Server pages call this first: flag off means the route 404s, exactly like before it existed. */
export function requireUiV2(): void {
  if (!UI_V2) notFound();
}
