import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { crossSite } from "@/lib/api/handler";
import { createServerClient } from "@/lib/supabase/server";

/** Supabase's session cookies: `sb-<ref>-auth-token`, split into `.0`, `.1`… when large (`lib/supabase/middleware.ts`). */
const isSessionCookie = (name: string) => name.startsWith("sb-") && name.includes("-auth-token");

export async function POST(request: NextRequest) {
  // Another site must not be able to sign a founder out with a hidden form (the same rule as every write of the API).
  if (crossSite(request)) return NextResponse.json({ detail: "Cross-site access denied." }, { status: 403 });

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signOut().catch((thrown: unknown) => ({ error: thrown }));
  if (error) console.error("[auth] sign-out did not reach Supabase Auth; the cookies are cleared here", error);
  // supabase-js keeps the session when Auth does not answer. The founder pressed Sign out, perhaps on a shared
  // computer, and is shown the landing page either way: the cookies go whatever Auth said.
  const store = await cookies();
  for (const { name } of store.getAll()) if (isSessionCookie(name)) store.delete(name);

  // A relative Location: `request.nextUrl.origin` does not read the `Host` header and answers `localhost` behind a
  // proxy (see `app/auth/callback/route.ts`). 303 turns the POST into a GET, or the browser would POST again.
  return new NextResponse(null, { status: 303, headers: { location: "/", "cache-control": "no-store" } });
}
