import type { Metadata } from "next";

import { Composer } from "@/components/today/Composer";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Post composer" };

export default function ComposePage() {
  requireUiV2();
  return <Composer />;
}
