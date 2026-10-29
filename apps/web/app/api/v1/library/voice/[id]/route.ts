import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Library → Voice: the founder deletes a note Writer learned (`voice_note_delete`); it is never written again. */
export const DELETE = withApi({ rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Note not found.");
  await rpcOrThrow(supabase, "voice_note_delete", { p_id: params.id });
  return { deleted: true };
});
