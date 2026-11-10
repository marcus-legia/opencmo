import { ApiError, withApi } from "@/lib/api/handler";
import { scriptForClip } from "@/lib/cmo/script";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The script this edit was opened from (cmo-review-3 I1), read under RLS: another founder's clip, or an edit that did
 * not come from a script, is a 404 and the editor shows no Script tab.
 */
export const GET = withApi({}, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "No script for this edit.");
  const script = await scriptForClip(supabase, params.id!);
  if (!script) throw new ApiError(404, "No script for this edit.");
  return script;
});
