import type { Metadata } from "next";

import { AgentWriter } from "@/components/today/AgentWriter";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Writer" };

export default function WriterPage() {
  requireUiV2();
  return <AgentWriter />;
}
