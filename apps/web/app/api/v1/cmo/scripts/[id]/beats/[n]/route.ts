import { z } from "zod";

import { ApiError, withApi } from "@/lib/api/handler";
import { editBeat } from "@/lib/cmo/script";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

const body = z
  .object({
    say: z.string().trim().min(1).max(300).optional(),
    show: z.string().trim().min(1).max(300).optional(),
    version: z.string().datetime({ offset: true }),
  })
  .refine((b) => b.say !== undefined || b.show !== undefined, "Write what to say or what to show.");

/**
 * One beat of an approved script, edited in the editor's Script tab (`cmo_script_edit_beat`, owner-checked). A stale
 * `version` is refused with 409: the tab reloads the script instead of writing over words the founder did not see.
 */
export const PATCH = withApi({ body, rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, body, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Script not found.");
  const beat = Number(params.n);
  if (!Number.isInteger(beat) || beat < 1 || beat > 8) throw new ApiError(404, "That beat is not in this script.");
  return editBeat(supabase, params.id!, beat, { say: body.say, show: body.show }, body.version);
});
