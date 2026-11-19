import { Suspense } from "react";
import type { Metadata } from "next";

import { BusinessView } from "@/components/today/BusinessView";
import { TodayLoading } from "@/components/today/TodayLoading";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Your business" };

export default function BusinessPage() {
  requireUiV2();
  // The page reads `?d=` (useSearchParams): its own boundary.
  return (
    <Suspense fallback={<TodayLoading label="Loading your documents" />}>
      <BusinessView />
    </Suspense>
  );
}
