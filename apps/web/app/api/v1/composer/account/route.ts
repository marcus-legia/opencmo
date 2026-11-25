import { z } from "zod";

import { rpcOrThrow, withApi } from "@/lib/api/handler";
import type { AccountContext } from "@/lib/composer/types";

export const dynamic = "force-dynamic";

const Body = z.object({
  username: z.string().max(30),
  karma: z.number().int().min(0).max(10_000_000).nullable().optional(),
  /** "2025-03" or "2025-03-01": the month the Reddit account was made. */
  accountCreatedAt: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).nullable().optional(),
});

/**
 * The founder's Reddit account as they type it (plan 2026-11-25): username, karma and account age from their Reddit
 * profile. `save_reddit_account` checks it and writes only their own row; an empty username clears it.
 */
export const PUT = withApi({ body: Body, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body }) => {
  const created = body.accountCreatedAt ? (body.accountCreatedAt.length === 7 ? `${body.accountCreatedAt}-01` : body.accountCreatedAt) : null;
  const rows = await rpcOrThrow<{ reddit_username: string | null; reddit_karma: number | null; reddit_created_at: string | null }[]>(supabase, "save_reddit_account", {
    p_username: body.username,
    p_karma: body.karma ?? null,
    p_created: created,
  });
  const row = rows?.[0];
  const account: AccountContext = {
    username: row?.reddit_username ?? null,
    karma: row?.reddit_karma ?? null,
    accountCreatedAt: row?.reddit_created_at ? `${row.reddit_created_at}T00:00:00Z` : null,
    postsInSub: 0,
    lastPostInSubAt: null,
  };
  return account;
});
