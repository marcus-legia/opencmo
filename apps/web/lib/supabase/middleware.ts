import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Làm mới phiên đăng nhập trên mỗi request.
 *
 * Server Component không ghi được cookie, nên nếu chỉ dựa vào chúng thì token
 * hết hạn sẽ đá người dùng ra ngoài giữa chừng. Middleware là chỗ duy nhất vừa
 * đọc vừa ghi được cookie — đây là lý do file này tồn tại.
 */
/**
 * Supabase keeps the session in `sb-<ref>-auth-token` cookies, split into `.0`, `.1`… when large. Without one there is
 * no session to refresh or check, so an anonymous visitor (the landing page, the blog, the login form) costs no call.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

function loginRedirect(request: NextRequest): NextResponse {
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Chỉ giữ đường dẫn NỘI BỘ: `next` là chỗ cổ điển để mở open redirect —
  // `//evil.example` cũng là một pathname hợp lệ với trình duyệt.
  const target = request.nextUrl.pathname;
  if (target.startsWith("/") && !target.startsWith("//")) {
    login.searchParams.set("next", target);
  }
  return NextResponse.redirect(login);
}

export async function updateSession(request: NextRequest) {
  const gated = /^\/(app|editor)(\/|$)/.test(request.nextUrl.pathname);
  if (!hasSessionCookie(request)) return gated ? loginRedirect(request) : NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // `getClaims` refreshes an expired access token (writing the new cookies through `setAll`) and then verifies the JWT
  // locally against the project's public key: no round trip to Auth on every request (lib/supabase/user.ts).
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && !!data?.claims?.sub;

  // Chặn ở đây thay vì trong từng trang: quên một trang là lộ một trang.
  //
  // `/api/v1` KHÔNG chuyển hướng: client của nó là `fetch`, và một redirect 307
  // tới trang HTML `/login` sẽ được `res.json()` đọc thành lỗi parse thay vì
  // "hãy đăng nhập lại". `withApi` trả 401 JSON.
  //
  // `/editor` đi cùng nhánh với `/app`: nó là cùng một workspace, chỉ khác ở
  // chỗ nó là một SPA tĩnh. Chưa đăng nhập mà mở thẳng nó thì bundle nạp xong,
  // lượt gọi `/api/v1/editor/project` trả 401, và người dùng nhìn một editor
  // rỗng kèm một toast — thay vì thấy form đăng nhập.
  if (!signedIn && gated) return loginRedirect(request);

  return response;
}
