import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { nameFrom, offerFrom, priceFrom } from "@/lib/cmo/competitor-site";
import { readSite, SiteError, type SiteSnapshot } from "@/lib/cmo/site";

export const dynamic = "force-dynamic";
// Reading a site is a few page fetches, each with its own timeout.
export const maxDuration = 60;

const body = z.object({
  url: z.string().trim().min(3).max(300),
  /** The name Research's chat found (C8); a website read alone takes the name from its title. */
  name: z.string().trim().min(1).max(80).optional(),
  via: z.enum(["url", "chat"]).default("url"),
});

/**
 * Research › Add one (wave 3, C5): the founder pastes a competitor's website. It is read with the site reader the
 * onboarding uses (public pages only, SSRF-checked), and its name, price, offer and logo are stored by
 * `competitor_add`. No model call: what is shown is what the site says.
 */
export const POST = withApi({ body, rateLimit: { bucket: "onboarding", limit: 20, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  let site: SiteSnapshot | null = null;
  try {
    site = await readSite(body.url);
  } catch (error) {
    // A site that will not open is still a competitor: keep the name and the address, with nothing read from it.
    if (!(error instanceof SiteError) && !(error instanceof TypeError)) throw error;
  }
  const row = await rpcOrThrow<{ id: string; name: string; site: string }>(supabase, "competitor_add", {
    p_url: site?.url ?? body.url,
    p_name: body.name ?? (site ? nameFrom(site.pages[0]?.title ?? "") : null),
    p_logo_url: site?.look?.logo_url || null,
    p_price: site ? priceFrom(site) : null,
    p_offer: site ? offerFrom(site) : null,
    p_via: body.via,
  });
  return { id: row.id, name: row.name, site: row.site, read: site !== null };
});

/** The competitors the founder keeps, for the left panel (RLS: their own rows). */
export const GET = withApi({}, async ({ supabase }) => {
  const { data, error } = await supabase.from("competitors").select("id, name, site").order("created_at", { ascending: false }).limit(20);
  if (error) throw new ApiError(503, "Could not load your competitors.");
  return { competitors: (data ?? []) as { id: string; name: string; site: string }[] };
});

const remove = z.object({ id: z.uuid() });

/** Remove one (`competitor_remove`). */
export const DELETE = withApi({ body: remove, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const removed = await rpcOrThrow<boolean>(supabase, "competitor_remove", { p_id: body.id });
  if (!removed) throw new ApiError(404, "Competitor not found.");
  return { removed: true };
});
