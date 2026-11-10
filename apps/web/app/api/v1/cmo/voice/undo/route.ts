import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

/** Undo on the Voice page: reverts the founder's latest change not undone yet (`cmo_voice_undo`). */
export const POST = withApi({ rateLimit: { bucket: "presets", limit: 60, windowSeconds: 3600 } }, async ({ supabase }) => {
  await rpcOrThrow(supabase, "cmo_voice_undo", {});
  return { ok: true };
});
