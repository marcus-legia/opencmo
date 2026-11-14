import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { SALES_PLATFORMS } from "@/lib/cmo/social/conversations";

export const dynamic = "force-dynamic";

const term = z.string().trim().min(1).max(60);
const body = z.object({
  /** Subreddit names, with or without `r/`; `sales_settings_save` normalises and checks them again. */
  excluded: z.array(z.string().trim().min(1).max(23)).max(50),
  /** Pairs of terms a thread must both contain to be scored. */
  pairs: z.array(z.tuple([term, term])).max(20),
  /** Sales finder: the places the scan looks, at least one. Left out, the saved ones stay. */
  platforms: z.array(z.enum(SALES_PLATFORMS)).min(1).max(4).optional(),
});

type Saved = { excluded_subreddits: string[]; co_occurrence: [string, string][]; platforms: string[] };

/**
 * Sales settings (P5 R1): subreddits the scan never reads and term pairs a thread must contain. The scan applies
 * them before scoring, so nothing is spent on a thread the founder ruled out.
 */
export const POST = withApi({ body, rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const saved = await rpcOrThrow<Saved | Saved[]>(supabase, "sales_settings_save", { p_excluded: body.excluded, p_pairs: body.pairs, p_platforms: body.platforms ?? null });
  const row = Array.isArray(saved) ? saved[0] : saved;
  return { excludedSubreddits: row?.excluded_subreddits ?? [], pairs: row?.co_occurrence ?? [], platforms: row?.platforms ?? [...SALES_PLATFORMS] };
});
