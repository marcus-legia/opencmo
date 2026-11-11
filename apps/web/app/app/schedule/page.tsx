import { Suspense } from "react";
import type { Metadata } from "next";

import { CalendarView } from "@/components/today/CalendarView";
import { TodayLoading } from "@/components/today/TodayLoading";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Calendar" };

export default function SchedulePage() {
  requireUiV2();
  // The Calendar reads `?from=` (useSearchParams): its own boundary, so the week waits and not the frame.
  return (
    <Suspense fallback={<TodayLoading label="Loading the calendar" />}>
      <CalendarView />
    </Suspense>
  );
}
