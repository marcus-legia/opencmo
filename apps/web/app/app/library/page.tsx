import { redirect } from "next/navigation";

import { requireUiV2 } from "@/lib/screens/flag";

const PANE: Record<string, string> = { business: "product", brand: "brand", voice: "voice", skills: "skills" };
const DOCUMENTS = new Set(["product", "strategy", "competitors", "content_strategy"]);

/**
 * Library's parts are panes of the Context drawer over the feed now (owner, 2026-11-10: fewer page jumps): the four
 * documents, the Brand Kit, Voice and Skills. Old links (`?tab=`, `?edit=<document>`) land on the same thing there.
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; sample?: string }> }) {
  requireUiV2();
  const { tab, edit, sample } = await searchParams;
  // Sample data (`?sample=1`) follows the founder to the pane.
  const more = sample === "1" ? "&sample=1" : "";
  if (edit && DOCUMENTS.has(edit)) redirect(`/app?doc=${edit}&edit=1${more}`);
  redirect(`/app?doc=${PANE[tab ?? ""] ?? "product"}${more}`);
}
