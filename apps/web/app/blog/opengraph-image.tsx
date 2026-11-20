import { OG_SIZE, ogCard } from "@/lib/og/card";
import { BLOG_URL } from "@/lib/site";

export const alt = "Ferreto Blog";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({ kicker: "Ferreto Blog", title: "Find your first customers without becoming a marketer.", footer: BLOG_URL.replace(/^https?:\/\//, "") });
}
