import { notFound, rpcOrThrow, withApi } from "@/lib/api/handler";
import { generationView, type GenerationRow } from "@/lib/generate/models";

export const dynamic = "force-dynamic";

/** Cancels a queued or running generation. Queued: credits refunded. Running: the provider was already paid, so they stay spent (trigger on `tasks`). */
export const POST = withApi({}, async ({ supabase, params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.id ?? "")) throw notFound("Generation not found.");
  const row = await rpcOrThrow<GenerationRow>(supabase, "cancel_generation", { p_id: params.id });
  return generationView(row);
});
