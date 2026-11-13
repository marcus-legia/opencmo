import type { Metadata } from "next";

import { PhotosView } from "@/components/today/PhotosView";
import { requireUiV2 } from "@/lib/screens/flag";

export const metadata: Metadata = { title: "Photos" };

export default function PhotosPage() {
  requireUiV2();
  return <PhotosView />;
}
