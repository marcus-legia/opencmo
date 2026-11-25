import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { supabaseStore } from "@/lib/cmo/jobs/store";
import { think } from "@/lib/cmo/jobs/think";
import { SocialReadError } from "@/lib/cmo/social/scrapecreators";
import { postsIn, readiness } from "@/lib/composer/account";
import { readSubreddit } from "@/lib/composer/rules";
import { COMPOSE_PLATFORMS, type AccountContext, type ComposerContext, type SubredditContext } from "@/lib/composer/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const Query = z.object({ platform: z.enum(COMPOSE_PLATFORMS), subreddit: z.string().max(40).optional() });

/**
 * What the Composer shows before the founder writes (plan 2026-11-25, Part L): for Reddit, the sub's rules, posting
 * guidance and avoid/use guide (read once a week, shared by every founder, written only by Ferreto's own model), and
 * whether the founder's account is ready for it.
 */
export const GET = withApi({ rateLimit: { bucket: "composer", limit: 120, windowSeconds: 3600 } }, async ({ supabase, user, request }) => {
  const query = Query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) throw new ApiError(400, "Pick a platform: reddit, x, threads or linkedin.");
  const { platform, subreddit } = query.data;
  const profile = await supabase.from("profiles").select("reddit_username, reddit_karma, reddit_created_at").eq("id", user.id).maybeSingle<{ reddit_username: string | null; reddit_karma: number | null; reddit_created_at: string | null }>();
  if (profile.error) throw new ApiError(500, "Could not read your account.");
  const account: AccountContext = {
    username: profile.data?.reddit_username ?? null,
    karma: profile.data?.reddit_karma ?? null,
    accountCreatedAt: profile.data?.reddit_created_at ? `${profile.data.reddit_created_at}T00:00:00Z` : null,
    postsInSub: 0,
    lastPostInSubAt: null,
  };
  let sub: SubredditContext | null = null;
  if (platform === "reddit" && subreddit) {
    try {
      sub = await readSubreddit({ store: supabaseStore(createAdminClient()), think, now: new Date() }, subreddit);
    } catch (error) {
      if (error instanceof RangeError) throw new ApiError(400, error.message);
      if (error instanceof SocialReadError) throw new ApiError(502, "Reddit did not answer. Try again in a minute.");
      throw error;
    }
    // The founder's posts in the sub: a search that fails only leaves the count at 0.
    if (account.username) Object.assign(account, await postsIn(account.username, sub.name).catch(() => ({ postsInSub: 0, lastPostInSubAt: null })));
  }
  const context: ComposerContext = { platform, subreddit: sub, account, readiness: platform === "reddit" ? readiness(sub, account) : { level: "ready", reasons: [] } };
  return context;
});
