import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InboxQueue } from "@/components/dashboard/InboxPages";
import { UI_V2 } from "@/components/ui/flag";

export const metadata: Metadata = { title: "Approve" };

/** The phone's Approve tab: the Dashboard queue on its own. */
export default function InboxPage() {
  if (!UI_V2) notFound();
  return <InboxQueue />;
}
