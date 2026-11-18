import { BRAND } from "@/components/landing/data";
import { OG_SIZE, ogCard } from "@/lib/og/card";

export const alt = `${BRAND}: find the people already asking for what you built`;
export const size = OG_SIZE;
export const contentType = "image/png";

// The footer stays on the live domain until the move to ferre.to.
export default function Image() {
  return ogCard({ kicker: "For founders who sell software to businesses", title: "Find the people already asking for what you built.", footer: "ferreto.io" });
}
