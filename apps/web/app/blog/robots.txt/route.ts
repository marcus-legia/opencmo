import { BLOG_URL, blogUrl } from "@/lib/site";

/**
 * The blog host's `robots.txt` (`blog.ferreto.io/robots.txt` is rewritten here, `next.config.ts`). Open to every
 * crawler, AI ones included, like the site's own (`app/robots.ts`); it points at the blog's sitemap, since a sitemap
 * lists only addresses on its own host.
 */
export function GET() {
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${blogUrl("/sitemap.xml")}`, `Host: ${BLOG_URL}`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
