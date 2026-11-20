import type { MetadataRoute } from "next";

import { blogSitemap } from "@/lib/blog-sitemap";
import { BLOG_URL, absoluteUrl, blogHost } from "@/lib/site";

/**
 * Public pages with content only. A sitemap lists only addresses on its own host: when the blog has its own
 * (`blog.ferreto.io`), its posts are in the blog's sitemap (`app/blog/sitemap.ts`), not here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    ...["/terms", "/privacy", "/acceptable-use", "/refund"].map((path) => ({ url: absoluteUrl(path), changeFrequency: "yearly" as const, priority: 0.2 })),
    ...(blogHost(BLOG_URL) ? [] : blogSitemap()),
  ];
}
