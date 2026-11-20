import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

import { CATEGORY_REDIRECTS } from "./content/blog/categories";
import blogRedirects from "./content/blog/redirects.json";
import { assertSentryDsn } from "./lib/ops/sentry-dsn";
import { blogBase, blogHost } from "./lib/site";

/**
 * Security headers.
 *
 * The CSP lists exactly what this app loads: no `unsafe-eval`, no wildcard host. Two places must be loosened,
 * and why:
 *
 *   - `script-src 'unsafe-inline'`: Next embeds hydration data in inline `<script>` tags. A per-request nonce
 *     would mean giving up static rendering entirely.
 *   - `style-src 'unsafe-inline'`: the editor canvas positions text with a `style` on each element; that is how
 *     users drag text on the frame.
 *
 * `'unsafe-eval'` is added ONLY under `next dev`: React Fast Refresh runs modules through `eval`, and without it
 * every edit is a CSP error and hot reload dies. A production build needs no eval, so it is never loosened there;
 * the condition reads `NODE_ENV`, which `next build` always sets to `production`.
 *
 * `connect-src`/`media-src` need the Supabase host: the browser talks DIRECTLY to Storage and Realtime (web rules
 * 3 and 5: files never pass through Next).
 *
 * Environment variables are read INSIDE `headers()`, not in the module body: `next start` loads `.env.local` after
 * requiring the config file, so reading them outside gives empty strings and the CSP blocks our own Supabase.
 */
function securityHeaders(): { key: string; value: string }[] {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const host = supabaseUrl.replace(/^https?:\/\//, "");
  const ws = host ? `${supabaseUrl.startsWith("https") ? "wss" : "ws"}://${host}` : "";
  // Storage của Supabase cloud phát file từ một host riêng
  // (`<ref>.storage.supabase.co`); trên máy local mọi thứ chung một origin.
  const storage = host.replace(/^([^.]+)\.supabase\.co$/, "$1.storage.supabase.co");
  // `wss` chỉ có nghĩa với `connect-src` (Realtime); đưa nó vào `media-src`
  // hay `img-src` là rác trong header, và rác trong CSP là chỗ để lẫn lỗi.
  const httpOrigins = [supabaseUrl, storage && storage !== host ? `https://${storage}` : ""]
    .filter(Boolean)
    .join(" ");
  const origins = [httpOrigins, ws].filter(Boolean).join(" ");

  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    // The blog's own host (`blog.ferreto.io`) sends its sign-up form to the site's `/login`: another origin.
    `form-action 'self' ${(process.env.NEXT_PUBLIC_SITE_URL || "https://ferreto.io").replace(/\/$/, "")}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${origins} https://*.sentry.io`.replace(/\s+/g, " "),
    `media-src 'self' blob: ${httpOrigins}`.replace(/\s+/g, " ").trim(),
    `img-src 'self' data: blob: ${httpOrigins}`.replace(/\s+/g, " ").trim(),
    // Font phục vụ ở `/fonts/` (chép từ `packages/clip-media` lúc build) — cùng origin, không cần host ngoài.
    "font-src 'self'",
    "worker-src 'self' blob:",
    // Nothing is framed: the YouTube player went with link import (2026-10-20), and its hosts with it. A third-party
    // host in `script-src` is a way around the policy for whoever finds a script to load from it.
    "frame-src 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    // Vercel tự gắn HSTS cho custom domain, nhưng header bảo mật của app không
    // nên phụ thuộc vào nhà cung cấp: đổi chỗ host là mất, mà mất thì im lặng.
    // Hai năm + subdomain vì `ferreto.io` chỉ phục vụ HTTPS.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
  ];
}

/**
 * On Vercel, the commit this deploy was built from, so the post-deploy smoke (`scripts/smoke-production.mts`) can tell
 * whether the domain already serves the deploy it was started for. A header rather than a custom build id: Next's own
 * build id stays per build (open tabs still hard-reload after any redeploy) and keeps its ad-blocker guard. A commit id
 * says nothing a closed-source repo needs to hide. Read at build, like the rest of `headers()`.
 */
function deployHeaders(): { key: string; value: string }[] {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return /^[0-9a-f]{7,40}$/.test(commit) ? [{ key: "X-Deploy-Commit", value: commit }] : [];
}

const e2eBuild = process.env.OPENCMO_E2E_BUILD === "1";
const config: NextConfig = {
  // `X-Powered-By: Next.js` tells a scanner which framework's CVEs to try first and tells users nothing (ZAP 10037).
  poweredByHeader: false,
  // Test và dev có thể cùng mở trên máy: không ghi đè manifest của nhau.
  distDir: e2eBuild ? ".next-e2e" : ".next",
  // Clip là file lớn: app không bao giờ proxy chúng, chỉ phát signed URL trỏ
  // thẳng vào Supabase Storage. Xem lib/storage.ts.
  experimental: { serverActions: { bodySizeLimit: "1mb" }, ...(e2eBuild ? { cpus: 2 } : {}) },
  /**
   * `editor-core`, `clip-doc`, `clip-render`, `clip-assets` là nguồn TypeScript
   * trong workspace (import có đuôi `.ts`): route `/api/v1/editor/*` áp op trên
   * server, shell editor vẽ preview bằng chúng trong trình duyệt — Next phải
   * transpile.
   */
  transpilePackages: ["@opencmo/editor-core", "@opencmo/skills", "@opencmo/clip-doc", "@opencmo/clip-render", "@opencmo/clip-assets", "@opencmo/clip-icons"],
  async headers() {
    // Evaluated by `next build` (and `next dev`), not by `next start`, which reads the built manifest: the bad-DSN gate
    // belongs to building, since the DSN is inlined into the client bundle there.
    assertSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
    return [{ source: "/:path*", headers: [...securityHeaders(), ...deployHeaders()] }];
  },
  /**
   * Post slugs never change; a renamed slug goes into `content/blog/redirects.json` (old → new). A 308 keeps the
   * ranking and outside links.
   *
   * The blog moved to its own host (`blog.ferreto.io`, owner 2026-11-20; `lib/site.ts` `blogBase`): every old
   * `ferreto.io/blog/...` address goes there with a 308, and a `/blog/...` address on the blog host (a link inside a
   * post) drops the prefix. Off production the blog stays a path and only the slug redirects apply. Env is read here,
   * not in the module body, for the reason given at `securityHeaders`.
   */
  async redirects() {
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ferreto.io").replace(/\/$/, "");
    const blog = blogBase(site, process.env.NEXT_PUBLIC_BLOG_URL, process.env.VERCEL_ENV);
    const host = blogHost(blog);
    // Moved blog addresses, relative to the blog's root.
    const moved = [
      ...Object.entries(blogRedirects as Record<string, string>).map(([from, to]) => [`/${from}`, `/${to}`]),
      ...Object.entries(CATEGORY_REDIRECTS).map(([from, to]) => [`/category/${from}`, `/category/${to}`]),
    ];
    const siteHost = new URL(site).host;
    // On a preview (or any other host) the blog stays a path, so a moved slug stays on that host too.
    const legacy = [
      ...(host ? moved.map(([from, to]) => ({ source: `/blog${from}`, has: [{ type: "host" as const, value: siteHost }], destination: `${blog}${to}`, permanent: true })) : []),
      ...moved.map(([from, to]) => ({ source: `/blog${from}`, destination: `/blog${to}`, permanent: true })),
    ];
    const onBlogHost = host
      ? [
          ...moved.map(([from, to]) => ({ source: from, has: [{ type: "host" as const, value: host }], destination: to, permanent: true })),
          { source: "/blog", has: [{ type: "host" as const, value: host }], destination: "/", permanent: true },
          { source: "/blog/:path*", has: [{ type: "host" as const, value: host }], destination: "/:path*", permanent: true },
        ]
      : [];
    // Only the site's own host: a preview deployment keeps serving `/blog` so it can be checked before a merge.
    const toBlogHost = host
      ? [
          { source: "/blog", has: [{ type: "host" as const, value: siteHost }], destination: blog, permanent: true },
          { source: "/blog/:path*", has: [{ type: "host" as const, value: siteHost }], destination: `${blog}/:path*`, permanent: true },
        ]
      : [];
    // Pages deleted in wave 4b (photo posts, the script prompter): an old link lands on the app, not a 404.
    const deleted = ["/app/photos", "/app/script/:path*"].map((source) => ({ source, destination: "/app", permanent: false }));
    return [...legacy, ...onBlogHost, ...toBlogHost, ...deleted];
  },
  /**
   * On the blog host, every page address maps onto the `app/blog` routes: `/` is the index, `/write-x-thread` a post,
   * `/robots.txt` and `/sitemap.xml` the blog's own. Files with an extension (icons, images) and `/_next/`, `/fonts/`
   * stay at the root, where they are served from.
   */
  async rewrites() {
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ferreto.io").replace(/\/$/, "");
    const host = blogHost(blogBase(site, process.env.NEXT_PUBLIC_BLOG_URL, process.env.VERCEL_ENV));
    if (!host) return [];
    const has = [{ type: "host" as const, value: host }];
    return {
      beforeFiles: [
        { source: "/", has, destination: "/blog" },
        { source: "/robots.txt", has, destination: "/blog/robots.txt" },
        { source: "/sitemap.xml", has, destination: "/blog/sitemap.xml" },
        { source: "/rss.xml", has, destination: "/blog/rss.xml" },
        // Not `/blog` itself: rewrites chain, and `/` → `/blog` would become `/blog/blog`.
        { source: "/:path((?!_next/|fonts/|api/|blog(?:/|$))[^.]+)", has, destination: "/blog/:path" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

/**
 * `ANALYZE=1` only (CI's `web` job, when the JS budget fails): writes webpack-bundle-analyzer's treemaps to
 * `.next/analyze/` so the failure says which library grew. Off, the wrapper returns the config unchanged.
 */
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "1", openAnalyzer: false });

/**
 * Uploads source maps so browser stack traces in Sentry point at our source, not minified chunks. The upload needs
 * `SENTRY_AUTH_TOKEN` (set on Vercel only); without it local and CI builds skip the step instead of warning. The maps
 * are deleted after upload, so they are never served publicly.
 */
export default withSentryConfig(withBundleAnalyzer(config), {
  org: "opencmo",
  project: "opencmo",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
  // The client sends errors only (`tracesSampleRate: 0` in instrumentation-client.ts), yet the SDK's tracing code was
  // the largest chunk on every page, the login form included. Shake it and the SDK's debug logger out of the bundle.
  // Under Turbopack (local dev) Next warns that Sentry's boolean `compiler.define` values are invalid; the warning is
  // harmless, and production builds (webpack) apply the shake.
  bundleSizeOptimizations: { excludeTracing: true, excludeDebugStatements: true },
});
