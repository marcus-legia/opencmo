import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LibraryView } from "@/components/today/LibraryView";
import { TodayLoading } from "@/components/today/TodayLoading";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Library" };

const PANE: Record<string, string> = { business: "product", brand: "brand", voice: "voice", skills: "skills" };
const DOCUMENTS = new Set(["product", "strategy", "competitors", "post_plan", "brand"]);

/**
 * The Library (wave 3): what people said in the conversations Sales kept. Its older parts (the documents, the Brand
 * Kit, Voice, Skills) are panes of the Context drawer over the feed; old links (`?tab=`, `?edit=<document>`) still land
 * there.
 */
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string; sample?: string }> }) {
  requireUiV2();
  const { tab, edit, sample } = await searchParams;
  // Sample data (`?sample=1`) follows the founder to the pane.
  const more = sample === "1" ? "&sample=1" : "";
  if (edit && DOCUMENTS.has(edit)) redirect(`/app?doc=${edit}&edit=1${more}`);
  if (tab) redirect(`/app?doc=${PANE[tab] ?? "product"}${more}`);
  // The page reads `?source=` (useSearchParams): its own boundary.
  return (
    <Suspense fallback={<TodayLoading label="Loading the Library" />}>
      <LibraryView />
    </Suspense>
  );
}
