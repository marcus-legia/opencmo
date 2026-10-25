import type { NextConfig } from "next";

import { CATEGORY_REDIRECTS } from "./content/blog/categories";
import blogRedirects from "./content/blog/redirects.json";

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
/**
 * Host của trình phát YouTube.
 *
 * `default-src 'self'` chặn iframe, nên thiếu `frame-src` thì ô video im lặng
 * không hiện — không có lỗi nào ngoài một dòng trong console. Và `iframe_api`
 * nạp tiếp một script từ `s.ytimg.com`, nên thiếu host đó thì iframe hiện lên
 * nhưng thanh chọn đoạn không biết video dài bao nhiêu.
 *
 * Liệt kê đúng ba host, không wildcard: CSP của app này viết theo những thứ nó
 * THẬT SỰ nạp, và một wildcard là chỗ để thứ khác lẫn vào sau này.
 */

const YOUTUBE_FRAME = "https://www.youtube-nocookie.com https://www.youtube.com";
const YOUTUBE_SCRIPT = "https://www.youtube.com https://s.ytimg.com";
const YOUTUBE_THUMBS = "https://i.ytimg.com";

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
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline' ${YOUTUBE_SCRIPT}${
      process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
    }`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${origins} https://*.sentry.io`.replace(/\s+/g, " "),
    `media-src 'self' blob: ${httpOrigins}`.replace(/\s+/g, " ").trim(),
    // `i.ytimg.com` là ảnh bìa YouTube. Màn xử lý hiện nó ngay khi job bắt
    // đầu: clip đầu tiên phải mất một phút mới có, và một phút nhìn chữ
    // "Reading your video…" là một phút người dùng nghĩ máy đang treo.
    `img-src 'self' data: blob: ${YOUTUBE_THUMBS} ${httpOrigins}`.replace(/\s+/g, " ").trim(),
    // Font phục vụ ở `/fonts/` (chép từ `packages/clip-media` lúc build) — cùng origin, không cần host ngoài.
    "font-src 'self'",
    "worker-src 'self' blob:",
    `frame-src ${YOUTUBE_FRAME}`,
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    // Vercel tự gắn HSTS cho custom domain, nhưng header bảo mật của app không
    // nên phụ thuộc vào nhà cung cấp: đổi chỗ host là mất, mà mất thì im lặng.
    // Hai năm + subdomain vì `opencmo.io` chỉ phục vụ HTTPS.
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

const e2eBuild = process.env.OPENCMO_E2E_BUILD === "1";
const config: NextConfig = {
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
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  /**
   * Slug bài viết là bất biến; đổi slug thì slug cũ phải vào
   * `content/blog/redirects.json` (cũ → mới). 308 giữ thứ hạng và link ngoài.
   */
  async redirects() {
    const posts = Object.entries(blogRedirects as Record<string, string>).map(([from, to]) => ({
      source: `/blog/${from}`,
      destination: `/blog/${to}`,
      permanent: true,
    }));
    const categories = Object.entries(CATEGORY_REDIRECTS).map(([from, to]) => ({
      source: `/blog/category/${from}`,
      destination: `/blog/category/${to}`,
      permanent: true,
    }));
    return [...posts, ...categories];
  },
};

export default config;
