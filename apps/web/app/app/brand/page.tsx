import { redirect } from "next/navigation";

import { BrandView } from "@/components/clipping/web/BrandView";
import { UI_V2 } from "@/components/screens/flag";

export default function BrandPage() {
  // The redesign moves the Brand Kit into Library (U6); old links keep working.
  if (UI_V2) redirect("/app/library?tab=brand");
  return <BrandView />;
}
