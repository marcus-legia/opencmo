import { redirect } from "next/navigation";

import { requireUiV2 } from "@/lib/screens/flag";

const PANE: Record<string, string> = { week: "plan", memory: "learned", past: "past" };

/** Brain is a pane of the Context drawer over the feed now (owner, 2026-11-10: fewer page jumps); old links land there. */
export default async function BrainPage({ searchParams }: { searchParams: Promise<{ tab?: string; sample?: string }> }) {
  requireUiV2();
  const { tab, sample } = await searchParams;
  // Sample data (`?sample=1`) follows the founder to the pane.
  const more = sample === "1" ? "&sample=1" : "";
  redirect(`/app?doc=${PANE[tab ?? ""] ?? "plan"}${more}`);
}
