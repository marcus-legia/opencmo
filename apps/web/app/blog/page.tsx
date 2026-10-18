import type { Metadata } from "next";

import { CategoryChips, Pagination } from "@/components/blog/BlogChrome";
import { PostList } from "@/components/blog/PostList";
import { JsonLd } from "@/components/seo/JsonLd";
import { POSTS_PER_PAGE, getAllPosts, pageCount } from "@/lib/blog";
import { OG_DEFAULTS, absoluteUrl } from "@/lib/site";

const TITLE = "Blog — marketing lessons from an AI CMO";
const DESCRIPTION =
  "Short, visual lessons on content, brand, video and selling, for founders and small teams who run their own marketing.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: { ...OG_DEFAULTS, type: "website", title: TITLE, description: DESCRIPTION, url: "/blog" },
};

export default function BlogIndex() {
  const posts = getAllPosts();
  return (
    <main className="blog-main">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: TITLE,
          description: DESCRIPTION,
          url: absoluteUrl("/blog"),
          hasPart: posts.slice(0, POSTS_PER_PAGE).map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: absoluteUrl(`/blog/${post.slug}`),
            datePublished: post.date,
          })),
        }}
      />
      <header className="blog-header">
        <p className="section-kicker">The OpenCMO Blog</p>
        <h1>Think like a CMO. Ship like a founder.</h1>
        <p>{DESCRIPTION}</p>
      </header>
      <CategoryChips />
      <PostList posts={posts.slice(0, POSTS_PER_PAGE)} feature />
      <Pagination page={1} pages={pageCount(posts.length)} />
    </main>
  );
}
