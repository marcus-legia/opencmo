import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { defaultCompetitorReaders, findCompetitors, knownNames, type CompetitorIdea } from "@/lib/agent/cmo-competitors";
import { RESEARCH_CALLS_PER_TURN } from "@/lib/agent/cmo-research";
import { LlmError } from "@/lib/cmo/jobs/llm-error";
import { ScBudget } from "@/lib/cmo/social/scrapecreators";
import { withSpend } from "@/lib/spend/record";

export const dynamic = "force-dynamic";
// A few searches and one model call.
export const maxDuration = 120;

const body = z.object({ query: z.string().trim().min(2).max(120) });

/**
 * Research's chat (wave 3, C8): the founder asks what else their customers use, and B7's `find_competitors` runs as it
 * does in the CMO chat: the same readers, the same research limit (`cmo_read_hit`, `chat_social`) and spend ledger.
 * It returns names with why and where; nothing is added until the founder presses Add (POST /research/competitors).
 */
export const POST = withApi({ body, rateLimit: { bucket: "agent-turn", limit: 120, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const { data: allowed, error } = await supabase.rpc("cmo_read_hit", { p_bucket: "chat_social" });
  if (error) throw new ApiError(503, "Could not check the research limit. Try again in a minute.");
  if (!allowed) throw new ApiError(429, "The research limit for now is reached. Try again later.");
  const budget = new ScBudget(RESEARCH_CALLS_PER_TURN);
  try {
    const found = await withSpend({ via: "founder", client: supabase, refKind: "agent_turn" }, async () =>
      findCompetitors(body.query, { readers: defaultCompetitorReaders(budget), known: await knownNames(supabase) }),
    );
    return { query: body.query, ideas: found.ideas satisfies CompetitorIdea[], failed: found.failed };
  } catch (err) {
    if (err instanceof LlmError) throw new ApiError(502, err.message);
    throw err;
  }
});
