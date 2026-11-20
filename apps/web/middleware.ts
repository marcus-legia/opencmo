import { NextResponse, type NextRequest } from "next/server";

import { BLOG_URL, blogHost } from "@/lib/site";
import { updateSession } from "@/lib/supabase/middleware";

const BLOG_HOST = blogHost(BLOG_URL);

export async function middleware(request: NextRequest) {
  // The blog's own host serves only static blog pages (`next.config.ts` rewrites): no session to refresh there.
  if (BLOG_HOST && request.headers.get("host") === BLOG_HOST) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  // Static files and images are skipped: they need no session, and running middleware for each one is compute paid
  // for nothing. `editor/assets/` is among them: the editor's Vite build is about 12 JS/CSS/font files, and an
  // `auth.getUser()` for EACH one was a round trip to Supabase per editor open. `/editor` and `/editor/index.html` are
  // NOT skipped: they are pages, and pages go through the sign-in gate. The blog and the SEO files are static public
  // pages: no session, and an `auth.getUser()` per crawl is money paid for bots. Fonts and the other files in `public/`
  // are static too: each one used to wait on a session check before the browser could paint text in it.
  //
  // On the blog's own host, post addresses (`/write-x-thread`) do not start with `blog`, so they reach the middleware,
  // which returns at once on the host check above: a matcher cannot name a host computed from the environment.
  matcher: [
    "/((?!_next/static|_next/image|editor/assets|fonts/|favicon.ico|api/health$|blog|robots.txt|sitemap.xml|llms.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?|ttf|otf)$).*)",
  ],
};
