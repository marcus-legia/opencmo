import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { InboxCardPage } from "@/components/dashboard/InboxPages";
import { UI_V2 } from "@/components/ui/flag";

export const metadata: Metadata = { title: "Approve" };

/** One card on its own page: the digest and push links open it (they never decide). */
export default async function InboxCard({ params }: { params: Promise<{ id: string }> }) {
  if (!UI_V2) notFound();
  const { id } = await params;
  return <InboxCardPage id={id.slice(0, 100)} />;
}
