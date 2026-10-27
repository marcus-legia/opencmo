import type { Metadata } from "next";

import { AnalyticsScreen } from "@/components/screens/analytics/AnalyticsScreen";
import { requireUiV2 } from "@/components/screens/flag";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  requireUiV2();
  return <AnalyticsScreen />;
}
