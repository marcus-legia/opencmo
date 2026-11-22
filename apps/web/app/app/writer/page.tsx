import type { Metadata } from "next";

import { AgentWriter } from "@/components/today/AgentWriter";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Posts" };

export default function WriterPage() {
  requireUiV2();
  return <AgentWriter />;
}
