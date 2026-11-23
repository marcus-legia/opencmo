import { NextResponse, type NextRequest } from "next/server";

import { logoHost } from "@/lib/cmo/logo";

export const maxDuration = 10;

const RASTER = /^image\/(?:png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp)\b/;

/**
 * A company's own icon, for competitors and the founder's product (owner, 2026-11-23: real logos, yours too). The
 * browser's CSP allows images from this origin only, so the icon comes through here. It is fetched from one fixed host
 * (Google's favicon service), never from the address in the query, so the route cannot be pointed at another server.
 * 404 when there is no icon: the page then draws the first letter.
 */
export async function GET(request: NextRequest) {
  const host = logoHost(request.nextUrl.searchParams.get("d") ?? "");
  if (!host) return new NextResponse(null, { status: 400 });
  try {
    const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, { signal: AbortSignal.timeout(5000), next: { revalidate: 604800 } });
    const type = res.headers.get("content-type") ?? "";
    // Raster only: an SVG served from this origin could run script if opened on its own.
    if (!res.ok || !RASTER.test(type)) return new NextResponse(null, { status: 404, headers: { "cache-control": "public, max-age=86400" } });
    const body = await res.arrayBuffer();
    if (body.byteLength > 200_000) return new NextResponse(null, { status: 404 });
    return new NextResponse(body, { headers: { "content-type": type, "cache-control": "public, max-age=604800, immutable", "x-content-type-options": "nosniff" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
