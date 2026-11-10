import type { Metadata } from "next";

import { AgentSales } from "@/components/today/AgentSales";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Sales" };

export default function SalesPage() {
  requireUiV2();
  return <AgentSales />;
}
