/**
 * Địa chỉ gốc của site — một chỗ cho canonical, sitemap, RSS, JSON-LD.
 *
 * Mặc định `https://ferreto.io`: build preview của Vercel không đặt biến này
 * thì canonical vẫn trỏ về domain thật, không để Google index bản preview.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ferreto.io").replace(/\/$/, "");

export const SITE_NAME = "Ferreto";

export const SITE_DESCRIPTION =
  "Ferreto finds the people already asking for what you built on Reddit, Hacker News, Threads and Facebook groups, with their own words as proof and a draft reply you post yourself. A week of posts comes with it.";

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
