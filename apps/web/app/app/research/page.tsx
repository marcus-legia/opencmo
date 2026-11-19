import type { Metadata } from "next";

import { ResearchView } from "@/components/today/ResearchView";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  requireUiV2();
  return <ResearchView />;
}
