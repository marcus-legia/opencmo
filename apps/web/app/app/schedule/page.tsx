import type { Metadata } from "next";

import { CalendarView } from "@/components/today/CalendarView";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Calendar" };

export default function SchedulePage() {
  requireUiV2();
  return <CalendarView />;
}
