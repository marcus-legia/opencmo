import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi, type SupabaseClient } from "@/lib/api/handler";
import { defaultBrandKit } from "@/lib/brand";
import { LIBRARY_LIMITS, type QuoteCardChoices } from "@/lib/cmo/library";
import { PLATFORM_LABEL, type SalesPlatform } from "@/lib/cmo/social/conversations";
import { PLAIN_COLORS, isSerifFont, quoteCardImage, safeColor } from "@/lib/og/quote-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Entry = { opportunity_id: string; platform: SalesPlatform; community: string; quotes: { text?: unknown }[] };

const communityOf = (e: Pick<Entry, "community" | "platform">) => e.community.trim() || PLATFORM_LABEL[e.platform] || "a public thread";

/** The post's Library entries (its sources), read under RLS: a founder only ever sees their own. */
async function postEntries(supabase: SupabaseClient, itemId: string): Promise<{ entries: Entry[]; current: QuoteCardChoices["current"] }> {
  const { data: item } = await supabase.from("content_items").select("body").eq("id", itemId).eq("department", "post").maybeSingle();
  if (!item) throw new ApiError(404, "Post not found.");
  const body = (item.body ?? {}) as { sources?: { opportunityId?: unknown }[]; quote_card?: { entryId?: string; quote?: string; object?: string } };
  const ids = (body.sources ?? []).map((s) => s.opportunityId).filter((id): id is string => typeof id === "string" && UUID.test(id));
  const card = body.quote_card;
  const current = card?.entryId && card.quote && card.object ? { entryId: card.entryId, quote: card.quote, object: card.object } : null;
  if (!ids.length) return { entries: [], current };
  const { data } = await supabase.from("library_entries").select("opportunity_id, platform, community, quotes").in("opportunity_id", ids);
  return { entries: (data ?? []) as Entry[], current };
}

/** The brand look for the card: the default Brand Kit's colours, type and logo, or the plain look without one. */
async function brandLook(supabase: SupabaseClient) {
  const row = await defaultBrandKit(supabase);
  if (!row) return { colors: { ...PLAIN_COLORS }, serif: false, logo: null };
  const { colors, fonts, logo } = row.kit;
  let logoImage: { src: string; width: number; height: number } | null = null;
  if (logo) {
    const { data } = await supabase.storage.from("brand").download(logo.object);
    if (data) logoImage = { src: `data:image/png;base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`, width: logo.width, height: logo.height };
  }
  return {
    colors: {
      background: safeColor(colors.background, PLAIN_COLORS.background),
      text: safeColor(colors.text, PLAIN_COLORS.text),
      accent: safeColor(colors.accent, PLAIN_COLORS.accent),
    },
    serif: isSerifFont(fonts.heading),
    logo: logoImage,
  };
}

/**
 * Quote cards (wave 4b B5/C7). Without `entry`: the quotes the post can use (from its sources in the Library) and the
 * card it carries. With `entry` and `quote`: the card as a PNG, to preview and then upload as one of the post's photos.
 */
export const GET = withApi({ rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params, request }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Post not found.");
  const { entries, current } = await postEntries(supabase, params.id!);
  const entryId = request.nextUrl.searchParams.get("entry");
  const quote = request.nextUrl.searchParams.get("quote");
  if (!entryId || quote === null) {
    const quotes = entries.flatMap((e) =>
      e.quotes.flatMap((q) => (typeof q.text === "string" && q.text.trim() ? [{ entryId: e.opportunity_id, community: communityOf(e), text: q.text }] : [])),
    );
    return { quotes, current } satisfies QuoteCardChoices;
  }
  const entry = entries.find((e) => e.opportunity_id === entryId);
  if (!entry || quote.length > LIBRARY_LIMITS.quoteChars || !entry.quotes.some((q) => q.text === quote)) {
    throw new ApiError(404, "Pick one of the quotes kept from this post's conversations.");
  }
  const image = await quoteCardImage({ quote, community: communityOf(entry), ...(await brandLook(supabase)) });
  return new NextResponse(await image.arrayBuffer(), { headers: { "content-type": "image/png", "cache-control": "private, no-store" } });
});

const setBody = z.object({ entryId: z.uuid(), quote: z.string().min(1).max(LIBRARY_LIMITS.quoteChars), object: z.string().min(1).max(500) });

/** Marks one of the post's photos as its quote card; `post_set_quote_card` checks the entry, the quote and the photo. */
export const POST = withApi({ body: setBody, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params, body }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Post not found.");
  const card = await rpcOrThrow(supabase, "post_set_quote_card", { p_item: params.id, p_entry: body.entryId, p_quote: body.quote, p_object: body.object });
  return { card };
});
