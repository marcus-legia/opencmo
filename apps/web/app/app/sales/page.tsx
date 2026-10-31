import type { Metadata } from "next";

import { SalesScreen } from "@/components/screens/sales/SalesScreen";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Sales" };

export default function SalesPage() {
  requireUiV2();
  return <SalesScreen />;
}
