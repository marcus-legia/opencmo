import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { PostingPlanSchema, planOrDefault, type PostingPlan } from "@/lib/cmo/posting-plan";

export const dynamic = "force-dynamic";

/**
 * The founder's posting plan (owner, 2026-11-12): which platforms get a post every day, how many, and how many video
 * scripts a week. `saved` is false while the founder has not chosen: the plan shown is the default for their connected
 * accounts, as the week plan reads it.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const [profile, accounts] = await Promise.all([
    supabase.from("profiles").select("posting_plan").eq("id", user.id).maybeSingle<{ posting_plan: unknown }>(),
    supabase.from("social_accounts").select("platform").eq("status", "connected"),
  ]);
  if (profile.error || accounts.error) throw new ApiError(500, "Could not read your posting plan.");
  const saved = PostingPlanSchema.safeParse(profile.data?.posting_plan).success;
  const connected = ((accounts.data ?? []) as { platform: string }[]).map((a) => a.platform);
  return { plan: planOrDefault(profile.data?.posting_plan, connected), saved };
});

/**
 * Saves the plan through `save_posting_plan`, which holds the bounds and moves the posts still only planned from today
 * on to the new platforms. The next week plan follows it.
 */
export const PUT = withApi(
  { body: PostingPlanSchema, rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, body }) => {
    const plan = await rpcOrThrow<PostingPlan>(supabase, "save_posting_plan", { p_plan: body });
    return { plan: PostingPlanSchema.parse(plan), saved: true };
  },
);
