import { Suspense } from "react";
import type { Metadata } from "next";

import { StudioScreen } from "@/components/screens/studio/StudioScreen";
import { TodayLoading } from "@/components/today/TodayLoading";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Studio" };

export default function StudioPage() {
  requireUiV2();
  // Studio reads its tab from the URL (useSearchParams): its own boundary.
  return (
    <Suspense fallback={<TodayLoading label="Loading your videos" />}>
      <StudioScreen />
    </Suspense>
  );
}
