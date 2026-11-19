import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 3_600_000;

export type LibraryCounts = { total: number; thisWeek: number; bySource: Record<SalesPlatform, number> };

/**
 * How many conversations the Library keeps (RLS: the founder's own `library_entries`), for the left panel's link and
 * the source filter's counts. Head counts only: the page itself reads the themes through `my_library`, and like it this
 * leaves out entries with no theme.
 */
export const GET = withApi({}, async ({ supabase }) => {
  const base = () => supabase.from("library_entries").select("opportunity_id", { count: "exact", head: true }).not("theme_id", "is", null);
  const since = new Date(Date.now() - WEEK_MS).toISOString();
  const [total, week, ...sources] = await Promise.all([base(), base().gt("created_at", since), ...SALES_PLATFORMS.map((p) => base().eq("platform", p))]);
  if (total.error || week.error || sources.some((s) => s.error)) throw new ApiError(503, "Could not count your Library.");
  const bySource = Object.fromEntries(SALES_PLATFORMS.map((p, i) => [p, sources[i]!.count ?? 0])) as Record<SalesPlatform, number>;
  return { total: total.count ?? 0, thisWeek: week.count ?? 0, bySource } satisfies LibraryCounts;
});
