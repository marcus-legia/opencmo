import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

/**
 * The founder's connected accounts (RLS: their own rows). Post cards read `platforms` to offer copy and open; the top bar
 * reads `accounts` for the handle it shows.
 */
export const GET = withApi({}, async ({ supabase }) => {
  const { data, error } = await supabase.from("social_accounts").select("platform, handle").eq("status", "connected").order("connected_at");
  if (error) throw new ApiError(503, "Could not load your accounts.");
  const rows = (data ?? []) as { platform: string; handle: string }[];
  return { platforms: [...new Set(rows.map((row) => row.platform))], accounts: rows.map((row) => ({ platform: row.platform, handle: row.handle })) };
});
