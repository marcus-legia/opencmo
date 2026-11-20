import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Breadcrumbs, CategoryChips } from "@/components/blog/BlogChrome";
import { PostList } from "@/components/blog/PostList";
import { JsonLd } from "@/components/seo/JsonLd";
import { CATEGORIES, findCategory } from "@/content/blog/categories";
import { getPostsByCategory } from "@/lib/blog";
import { blogUrl, OG_DEFAULTS } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const category = findCategory((await params).category);
  if (!category) return {};
  const posts = getPostsByCategory(category.slug);
  return {
    title: `${category.name} — guides and playbooks`,
    description: category.description,
    alternates: { canonical: blogUrl(`/category/${category.slug}`) },
    openGraph: { ...OG_DEFAULTS, type: "website", title: `${category.name} · Ferreto Blog`, description: category.description, url: blogUrl(`/category/${category.slug}`), images: [{ url: blogUrl(`/category/${category.slug}/opengraph-image`), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", images: [{ url: blogUrl(`/category/${category.slug}/opengraph-image`), width: 1200, height: 630 }] },
    // An empty category is a thin page: not indexed until it has a post.
    robots: posts.length === 0 ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const category = findCategory((await params).category);
  if (!category) notFound();
  const posts = getPostsByCategory(category.slug);
  const url = blogUrl(`/category/${category.slug}`);
  return (
    <main className="blog-main">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${category.name} · Ferreto Blog`,
            description: category.description,
            url,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Blog", item: blogUrl() },
              { "@type": "ListItem", position: 2, name: category.name, item: url },
            ],
          },
        ]}
      />
      <Breadcrumbs items={[{ name: "Blog", href: blogUrl() }, { name: category.name }]} />
      <header className="blog-header is-compact">
        <p className="section-kicker">Category</p>
        <h1>{category.name}</h1>
        <p>{category.description}</p>
      </header>
      <CategoryChips active={category.slug} />
      <PostList posts={posts} feature={false} />
    </main>
  );
}
