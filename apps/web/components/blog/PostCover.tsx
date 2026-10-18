import { findCategory } from "@/content/blog/categories";

/**
 * Post cover drawn in CSS from the post's own title, not an image file: the scheduled
 * run never has to make art, every cover belongs to one system, and it costs no bytes.
 * Each category gets its own dark tone so the grid groups at a glance.
 */
export function PostCover({ title, category, size = "card" }: { title: string; category: string; size?: "card" | "feature" }) {
  const name = findCategory(category)?.name ?? category;
  return (
    <div className={`post-cover is-${category} is-${size}`} aria-hidden="true">
      <span className="post-cover-label">{name}</span>
      <span className="post-cover-title">{title}</span>
      <span className="post-cover-mark">OpenCMO</span>
    </div>
  );
}
