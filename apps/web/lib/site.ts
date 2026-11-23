/**
 * Địa chỉ gốc của site — một chỗ cho canonical, sitemap, RSS, JSON-LD.
 *
 * Mặc định `https://ferreto.io`: build preview của Vercel không đặt biến này
 * thì canonical vẫn trỏ về domain thật, không để Google index bản preview.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ferreto.io").replace(/\/$/, "");

export const SITE_NAME = "Ferreto";

/**
 * Where the blog lives. On production it is its own host, `blog.ferreto.io` (owner, 2026-11-20); the pages are the
 * same `app/blog` routes, and `next.config.ts` maps the host onto them and sends old `ferreto.io/blog/...` links there
 * with a 308. Anywhere else it stays a path: `<site>/blog` locally, in e2e and CI, and plain `/blog` on a Vercel
 * preview, whose own address is not the site's, so a reviewer clicking through stays on the preview.
 * `NEXT_PUBLIC_BLOG_URL` overrides all of these.
 */
export function blogBase(siteUrl: string, override?: string, vercelEnv?: string): string {
  if (override) return override.replace(/\/$/, "");
  if (vercelEnv === "preview") return "/blog";
  return siteUrl === "https://ferreto.io" ? "https://blog.ferreto.io" : `${siteUrl}/blog`;
}

export const BLOG_URL = blogBase(SITE_URL, process.env.NEXT_PUBLIC_BLOG_URL, process.env.NEXT_PUBLIC_VERCEL_ENV);

/** The blog's own host when it has one (`blog.ferreto.io`), else null: the blog is a path of the site. */
export function blogHost(base: string): string | null {
  if (base.startsWith("/")) return null;
  const url = new URL(base);
  return url.pathname === "/" || url.pathname === "" ? url.host : null;
}

/** An absolute blog address: `blogUrl("/write-x-thread")`, `blogUrl()` for the index. */
export function blogUrl(path = "/"): string {
  return path === "/" ? BLOG_URL : `${BLOG_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export const SITE_DESCRIPTION =
  "Ferreto finds the people already asking for what you built on Reddit, Hacker News, Threads and Facebook groups, with their own words as proof and an idea for a reply you write and post yourself. A week of posts comes with it.";

/** Email hỗ trợ — phải TRÙNG email khai với bên thanh toán (Creem đối chiếu khi duyệt). */
export const SUPPORT_EMAIL = "support@ferreto.io";

export function absoluteUrl(path = "/"): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * `openGraph` của một trang THAY HẲN bản của layout (Next không gộp sâu), nên
 * trang nào khai `openGraph` phải trải lại các trường chung này.
 */
export const OG_DEFAULTS = { siteName: SITE_NAME, locale: "en_US" } as const;
