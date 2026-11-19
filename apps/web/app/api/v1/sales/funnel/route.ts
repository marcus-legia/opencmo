import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { FUNNEL_SOURCES, type FunnelRow } from "@/lib/cmo/funnel-view";

export const dynamic = "force-dynamic";

/**
 * The funnel (wave 3, A5's `my_funnel`): found, replied, answered back and signed up over the last `days` (1 to 90,
 * 7 by default), all sources first, then each one. The left panel reads the week; Analytics a month.
 */
export const GET = withApi({}, async ({ supabase, request }) => {
  const raw = Number(new URL(request.url).searchParams.get("days") ?? 7);
  const days = Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 7;
  const { data, error } = await supabase.rpc("my_funnel", { p_days: days });
  if (error) throw new ApiError(503, "Could not count your funnel.");
  const rows = ((data ?? []) as { source: string; found: number; replied: number; answered_back: number; signed_up: number }[])
    .filter((r): r is typeof r & { source: FunnelRow["source"] } => (FUNNEL_SOURCES as readonly string[]).includes(r.source))
    .map((r) => ({ source: r.source, found: Number(r.found), replied: Number(r.replied), answeredBack: Number(r.answered_back), signedUp: Number(r.signed_up) }));
  return { days, rows } satisfies { days: number; rows: FunnelRow[] };
});
