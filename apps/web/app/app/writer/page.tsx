import type { Metadata } from "next";

import { WriterScreen } from "@/components/screens/writer/WriterScreen";
import { requireUiV2 } from "@/components/screens/flag";

export const metadata: Metadata = { title: "Writer" };

export default function WriterPage() {
  requireUiV2();
  return <WriterScreen />;
}
