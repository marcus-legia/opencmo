import type { Metadata } from "next";

import { AnalyticsView } from "@/components/today/AnalyticsView";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  requireUiV2();
  return <AnalyticsView />;
}
