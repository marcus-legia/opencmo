import type { MetadataRoute } from "next";

import { blogSitemap } from "@/lib/blog-sitemap";

/** The blog's sitemap (`blog.ferreto.io/sitemap.xml`, rewritten here by `next.config.ts`). */
export default function sitemap(): MetadataRoute.Sitemap {
  return blogSitemap();
}
