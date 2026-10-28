import type { Metadata } from "next";

import { ResearchScreen } from "@/components/screens/research/ResearchScreen";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  requireUiV2();
  return <ResearchScreen />;
}
