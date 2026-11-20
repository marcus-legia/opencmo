import type { MetadataRoute } from "next";

import { CATEGORIES } from "@/content/blog/categories";
import { getAllPosts, getPostsByCategory, pageCount } from "@/lib/blog";
import { blogUrl } from "@/lib/site";

/** Every blog address with its REAL update date: the blog host's sitemap, or part of the site's when the blog is a path. */
export function blogSitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  const latest = posts[0]?.updated;
  const pages = pageCount(posts.length);
  return [
    { url: blogUrl(), lastModified: latest, changeFrequency: "daily", priority: 0.8 },
    ...Array.from({ length: pages - 1 }, (_, i) => ({ url: blogUrl(`/page/${i + 2}`), lastModified: latest })),
    ...CATEGORIES.filter((c) => getPostsByCategory(c.slug).length > 0).map((c) => ({
      url: blogUrl(`/category/${c.slug}`),
      lastModified: getPostsByCategory(c.slug)[0]?.updated,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...posts.map((post) => ({ url: blogUrl(`/${post.slug}`), lastModified: post.updated, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
