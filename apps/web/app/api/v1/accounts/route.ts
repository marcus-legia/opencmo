import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

/** The platforms the founder has a connected account on (RLS: their own rows). Post cards read it to offer copy and open. */
export const GET = withApi({}, async ({ supabase }) => {
  const { data, error } = await supabase.from("social_accounts").select("platform").eq("status", "connected");
  if (error) throw new ApiError(503, "Could not load your accounts.");
  return { platforms: [...new Set(((data ?? []) as { platform: string }[]).map((row) => row.platform))] };
});
