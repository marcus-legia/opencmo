import { OG_SIZE, ogCard } from "@/lib/og/card";

export const alt = "OpenCMO Blog";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({ kicker: "OpenCMO Blog", title: "Think like a CMO. Ship like a founder.", footer: "opencmo.io/blog" });
}
