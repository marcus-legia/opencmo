import type { Metadata } from "next";

import { BrainScreen } from "@/components/screens/brain/BrainScreen";
import { requireUiV2 } from "@/components/screens/flag";

export const metadata: Metadata = { title: "Brain" };

export default function BrainPage() {
  requireUiV2();
  return <BrainScreen />;
}
