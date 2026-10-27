import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UI_V2 } from "@/components/ui/flag";

import { DesignSheet } from "./DesignSheet";

export const metadata: Metadata = { title: "Design" };

/** Every v2 primitive in every state, for look checks against Tokens.dc.html. Flag-only and not linked. */
export default function DesignPage() {
  if (!UI_V2) notFound();
  return <DesignSheet />;
}
