import type { Metadata } from "next";

import { LibraryScreen } from "@/components/screens/library/LibraryScreen";
import { requireUiV2 } from "@/components/screens/flag";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  requireUiV2();
  return <LibraryScreen />;
}
