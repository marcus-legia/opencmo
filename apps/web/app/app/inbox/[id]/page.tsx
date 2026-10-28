import type { Metadata } from "next";

import { InboxCardPage } from "@/components/dashboard/InboxPages";
import { isProduction } from "@/lib/production";
import { requireUiV2 } from "@/lib/screens/flag";
import { ALL_KINDS, STATE_CARDS } from "@/lib/screens/fixtures/cards";

export const metadata: Metadata = { title: "Approve" };

/** One card on its own page: the digest and push links open it (they never decide). */
export default async function InboxCard({ params }: { params: Promise<{ id: string }> }) {
  requireUiV2();
  const id = (await params).id.slice(0, 100);
  // The component sheet's fixture cards open here for look checks; the server picks one, so no fixture text ships
  // in the client bundle, and production never serves them.
  const sampleCard = isProduction() ? null : ([...ALL_KINDS, ...STATE_CARDS].find((card) => card.id === id) ?? null);
  return <InboxCardPage id={id} sampleCard={sampleCard} />;
}
