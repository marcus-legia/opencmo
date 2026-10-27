import type { Metadata } from "next";

import { SetupScreen } from "@/components/screens/setup/SetupScreen";
import { requireUiV2 } from "@/components/screens/flag";

export const metadata: Metadata = { title: "Setup" };

export default function SetupPage() {
  requireUiV2();
  return <SetupScreen />;
}
