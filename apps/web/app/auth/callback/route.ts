import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/auth/next";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Chuyển hướng bằng `Location` TƯƠNG ĐỐI.
 *
 * Vì sao không ghép `request.nextUrl.origin`: thuộc tính đó KHÔNG đọc header
 * `Host`. Chạy `next start` sau một proxy — hoặc chỉ cần phục vụ trên
 * `127.0.0.1` — thì nó trả về `http://localhost:<port>`. Cookie phiên vừa được
 * ghi cho host thật, rồi redirect sang `localhost` là sang một origin khác:
 * trình duyệt không gửi cookie theo, `/app` thấy chưa đăng nhập và đá ngược về
 * `/login`. Đăng nhập hỏng mà không in ra một dòng lỗi nào — đúng kiểu lỗi im
 * lặng đắt nhất. Location tương đối để trình duyệt tự giải theo host thật.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

/**
 * Đích của Google OAuth (PKCE). Đổi `code` lấy phiên rồi chuyển tiếp vào app.
 *
 * Route handler chứ không phải Server Component: chỉ ở đây mới ghi được cookie
 * phiên đăng nhập.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const url = searchParams.get("url");
  const site = searchParams.get("site");

  // Người dùng bấm huỷ ở màn Google: Supabase gửi `error`, không có `code`.
  if (searchParams.get("error")) {
    return redirectTo("/login?error=huy");
  }
  if (!code) {
    return redirectTo("/login?error=thieu-ma");
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectTo("/login?error=link-het-han");
  }

  // `next` is untrusted user input; `safeNext` keeps it on this site (security fixes plan, fix 3).
  const target = new URL(safeNext(searchParams.get("next")), "http://redirect.invalid");
  if (url) target.searchParams.set("url", url);
  // A website typed in the hero goes to `/app` (AI CMO), where W0 Onboarding reads it. Never fold it
  // into `url`: `url` is a video link, and the app would start a clip job from it.
  if (site) target.searchParams.set("site", site);
  return redirectTo(`${target.pathname}${target.search}`);
}
