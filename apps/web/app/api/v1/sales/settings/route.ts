import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { SCAN_CADENCES, type Cadence } from "@/lib/cmo/funnel-view";
import { SALES_PLATFORMS } from "@/lib/cmo/social/conversations";

export const dynamic = "force-dynamic";


const term = z.string().trim().min(1).max(60);
const body = z.object({
  /** Subreddit names, with or without `r/`; `sales_settings_save` normalises and checks them again. Left out, kept. */
  excluded: z.array(z.string().trim().min(1).max(23)).max(50).optional(),
  /** Pairs of terms a thread must both contain to be scored. Left out, kept. */
  pairs: z.array(z.tuple([term, term])).max(20).optional(),
  /** Sales finder: the places the scan looks, at least one. Left out, the saved ones stay. */
  platforms: z.array(z.enum(SALES_PLATFORMS)).min(1).max(4).optional(),
  /** Settings › Sales scans. Left out, the saved one stays. */
  cadence: z.enum(SCAN_CADENCES).optional(),
});

type Saved = { excluded_subreddits: string[]; co_occurrence: [string, string][]; platforms: string[]; cadence: Cadence };

const shape = (row: Saved | undefined) => ({
  excludedSubreddits: row?.excluded_subreddits ?? [],
  pairs: row?.co_occurrence ?? [],
  platforms: row?.platforms ?? [...SALES_PLATFORMS],
  cadence: (row?.cadence ?? "mwf") as Cadence,
});

/**
 * Sales settings (P5 R1; wave 3 A5): subreddits the scan never reads, term pairs a thread must contain, the places it
 * looks and how often it scans on its own. A save may send only what changed (Settings › Sales scans sends the
 * cadence): the rest is read back first, since `sales_settings_save` takes the whole list each time.
 */
export const POST = withApi({ body, rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  let excluded = body.excluded;
  let pairs = body.pairs;
  if (!excluded || !pairs) {
    const { data, error } = await supabase.from("sales_settings").select("excluded_subreddits, co_occurrence").maybeSingle<{ excluded_subreddits: string[]; co_occurrence: [string, string][] }>();
    if (error) throw new ApiError(503, "Could not read your Sales settings.");
    excluded ??= data?.excluded_subreddits ?? [];
    pairs ??= data?.co_occurrence ?? [];
  }
  const saved = await rpcOrThrow<Saved | Saved[]>(supabase, "sales_settings_save", { p_excluded: excluded, p_pairs: pairs, p_platforms: body.platforms ?? null, p_cadence: body.cadence ?? null });
  return shape(Array.isArray(saved) ? saved[0] : saved);
});

/** The saved settings (RLS: the founder's own row), for Settings › Sales scans. */
export const GET = withApi({}, async ({ supabase }) => {
  const { data, error } = await supabase.from("sales_settings").select("excluded_subreddits, co_occurrence, platforms, cadence").maybeSingle<Saved>();
  if (error) throw new ApiError(503, "Could not read your Sales settings.");
  return shape(data ?? undefined);
});
