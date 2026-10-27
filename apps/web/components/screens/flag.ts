import { notFound } from "next/navigation";

import { UI_V2 } from "@/components/ui/flag";

/** Server pages of the redesign call this first: with the flag off the route 404s, as if it did not exist. */
export function requireUiV2(): void {
  if (!UI_V2) notFound();
}
