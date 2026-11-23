import { NextResponse, type NextRequest } from "next/server";

import { logoHost } from "@/lib/cmo/logo";
import { fetchIcon } from "@/lib/cmo/site";
import { currentUser } from "@/lib/supabase/user";

export const maxDuration = 10;

const RASTER = /^image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp)\b/;

export const runtime = "nodejs";

/**
 * A company's own icon, for competitors and the founder's product (owner, 2026-11-23: real logos, yours too). The
 * browser's CSP allows images from this origin only, so the icon comes through here. It is fetched from one fixed host
 * (Google's favicon service), never from the address in the query, so the route cannot be pointed at another server.
 * When Google has none, the site's own icon at its usual paths. 404 when there is no icon: the page draws the letter.
 */
/** Where a site keeps its icon when Google's service has none yet (a new domain such as ferreto.io in November 2026). */
const OWN_ICONS = ["/apple-touch-icon.png", "/apple-icon.png", "/favicon.ico", "/icon.png"];

const image = (type: string, body: ArrayBuffer | Buffer) =>
  new NextResponse(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "private, max-age=604800, immutable", "x-content-type-options": "nosniff" } });

export async function GET(request: NextRequest) {
  // Signed-in only: the route makes outbound requests, so it is not an open fetcher for anyone on the web.
  if (!(await currentUser())) return new NextResponse(null, { status: 401 });
  const host = logoHost(request.nextUrl.searchParams.get("d") ?? "");
  if (!host) return new NextResponse(null, { status: 400 });
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, { signal: AbortSignal.timeout(5000), next: { revalidate: 604800 } });
    const type = res.headers.get("content-type") ?? "";
    // Raster only: an SVG served from this origin could run script if opened on its own.
    if (res.ok && RASTER.test(type)) {
      const body = await res.arrayBuffer();
      if (body.byteLength <= 200_000) return image(type, body);
    }
  } catch {
    // The site's own icon is tried next.
  }
  // The site itself, through the site reader's checks (public addresses only, every redirect checked).
  for (const path of OWN_ICONS) {
    try {
      const icon = await fetchIcon(new URL(`https://${host}${path}`));
      if (icon) return image(icon.type, icon.body);
    } catch {
      // Not reachable or not public: the next path, then the letter.
    }
  }
  return new NextResponse(null, { status: 404, headers: { "cache-control": "private, max-age=86400" } });
}
