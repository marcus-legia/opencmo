import Link from "next/link";

import { CATEGORIES } from "@/content/blog/categories";
import { getPostsByCategory } from "@/lib/blog";
import { blogUrl } from "@/lib/site";

/** Hàng chip category; chip đang xem có `aria-current`. Category chưa có bài thì không hiện chip. */
export function CategoryChips({ active }: { active?: string }) {
  return (
    <nav className="blog-chips" aria-label="Categories">
      <Link href={blogUrl()} aria-current={active ? undefined : "page"}>All posts</Link>
      {CATEGORIES.filter((c) => c.slug === active || getPostsByCategory(c.slug).length > 0).map((c) => (
        <Link key={c.slug} href={blogUrl(`/category/${c.slug}`)} aria-current={active === c.slug ? "page" : undefined}>
          {c.name}
        </Link>
      ))}
    </nav>
  );
}

/** Pagination: page 1 is the blog's index (there is no `/page/1`: one piece of content, one address). */
export function Pagination({ page, pages, base = blogUrl() }: { page: number; pages: number; base?: string }) {
  if (pages <= 1) return null;
  const href = (n: number) => (n === 1 ? base : `${base}/page/${n}`);
  return (
    <nav className="blog-pagination" aria-label="Pagination">
      {page > 1 ? <Link href={href(page - 1)} rel="prev">← Newer</Link> : <span aria-hidden="true" />}
      <ol>
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            <Link href={href(n)} aria-current={n === page ? "page" : undefined}>{n}</Link>
          </li>
        ))}
      </ol>
      {page < pages ? <Link href={href(page + 1)} rel="next">Older →</Link> : <span aria-hidden="true" />}
    </nav>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav className="blog-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, i) => (
          <li key={item.name}>
            {item.href && i < items.length - 1 ? <Link href={item.href}>{item.name}</Link> : <span aria-current="page">{item.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
