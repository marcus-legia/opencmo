import type { Metadata } from "next";

import { InboxQueue } from "@/components/dashboard/InboxPages";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Approve" };

/** The phone's Approve tab: the Dashboard queue on its own. */
export default function InboxPage() {
  requireUiV2();
  return <InboxQueue />;
}
