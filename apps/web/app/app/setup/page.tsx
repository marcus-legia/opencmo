import { Suspense } from "react";
import type { Metadata } from "next";

import { SetupScreen } from "@/components/screens/setup/SetupScreen";
import { TodayLoading } from "@/components/today/TodayLoading";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Setup" };

export default function SetupPage() {
  requireUiV2();
  // Setup reads `?site=` and `?paid=` (useSearchParams): its own boundary.
  return (
    <Suspense fallback={<TodayLoading label="Loading setup" />}>
      <SetupScreen />
    </Suspense>
  );
}
