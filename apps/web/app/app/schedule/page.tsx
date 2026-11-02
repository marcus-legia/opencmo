import type { Metadata } from "next";

import { ScheduleScreen } from "@/components/screens/schedule/ScheduleScreen";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  requireUiV2();
  return <ScheduleScreen />;
}
