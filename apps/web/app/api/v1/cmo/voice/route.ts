import { withApi } from "@/lib/api/handler";
import { voicePage } from "@/lib/cmo/voice";

export const dynamic = "force-dynamic";

/** Library → Voice (cmo-review-3 2.3): the rules, the voice from setup and the history, under the founder's session. */
export const GET = withApi({}, async ({ supabase }) => voicePage(supabase));
