import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { studio } from "@/lib/departments/studio/adapter";
import { DOCUMENT_HASH } from "@/lib/departments/studio/finished";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const body = z.object({
  /** The `document_hash` of the saved edit the founder sees (the editor's last save, or the Studio item). */
  documentHash: z.string().regex(DOCUMENT_HASH, "Save the edit, then mark it finished."),
});

/** "Mark finished" (P2 F6): refused with 409 when the edit was saved again since the founder looked. */
export const POST = withApi(
  { body, rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } },
  async ({ supabase, user, body, params }) => {
    if (!UUID.test(params.clipId ?? "")) throw new ApiError(404, "Edit not found.");
    const marked = await studio({ supabase, userId: user.id, caller: "ui" }).markFinished(params.clipId!, body.documentHash);
    if (marked.kind === "stale") throw new ApiError(409, marked.message);
    return { finishedAt: marked.finishedAt, documentHash: marked.hash };
  },
);
