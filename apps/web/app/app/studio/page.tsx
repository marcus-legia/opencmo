import type { Metadata } from "next";

import { StudioScreen } from "@/components/screens/studio/StudioScreen";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  requireUiV2();
  return <StudioScreen />;
}
