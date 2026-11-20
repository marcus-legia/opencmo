import type { Metadata } from "next";

import { CategoryChips, Pagination } from "@/components/blog/BlogChrome";
import { PostList } from "@/components/blog/PostList";
import { JsonLd } from "@/components/seo/JsonLd";
import { POSTS_PER_PAGE, getAllPosts, pageCount } from "@/lib/blog";
import { blogUrl, OG_DEFAULTS } from "@/lib/site";

const TITLE = "Blog: finding your first customers, for founders";
const DESCRIPTION =
  "Practical guides on finding customers, positioning, launching and posting, for founders and small teams who sell software and run their own marketing.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: blogUrl() },
  // The OG image is named on the blog's own host: the file-convention address resolves against the site, a 308 away.
  openGraph: { ...OG_DEFAULTS, type: "website", title: TITLE, description: DESCRIPTION, url: blogUrl(), images: [{ url: blogUrl("/opengraph-image"), width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: [{ url: blogUrl("/opengraph-image"), width: 1200, height: 630 }] },
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
          url: blogUrl(),
          hasPart: posts.slice(0, POSTS_PER_PAGE).map((post) => ({
            "@type": "BlogPosting",
            headline: post.title,
            url: blogUrl(`/${post.slug}`),
            datePublished: post.date,
          })),
        }}
      />
      <header className="blog-header">
        <p className="section-kicker">The Ferreto Blog</p>
        <h1>Find your first customers without becoming a marketer.</h1>
        <p>{DESCRIPTION}</p>
      </header>
      <CategoryChips />
      <PostList posts={posts.slice(0, POSTS_PER_PAGE)} feature />
      <Pagination page={1} pages={pageCount(posts.length)} />
    </main>
  );
}
