import "server-only";

/**
 * Starts editing an uploaded video: the one way a project begins (owner, 2026-10-20 — clipping and
 * link import are gone). Checked early here so the error names the right problem;
 * `create_upload_edit()` checks again and is the real gate, holding credits in the same transaction
 * (web rule 1).
 */

import { after } from "next/server";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { projectShape, type JobRow } from "@/lib/api/shapes";
import { sourceProblem } from "@/lib/api/source";
import { wakeWorker } from "@/lib/modal";
import { ASPECTS } from "@/lib/settings-schema";

export const createUploadEditInput = z.object({
  source: z.string().min(1).max(2000),
  aspect: z.enum(ASPECTS).default("9:16"),
  // On/off only: the style is picked in the editor.
  captions: z.boolean().default(true),
});
export type CreateUploadEditInput = z.infer<typeof createUploadEditInput>;

// No route rate limit: `create_upload_edit()` calls `rate_limit_hit('jobs', 10, 3600)` itself —
// counting in two places would turn ten real jobs into five.
export async function createUploadEdit(supabase: SupabaseClient, userId: string, body: CreateUploadEditInput) {
  const source = body.source.trim();
  const problem = sourceProblem(source, userId);
  if (problem) throw new ApiError(422, problem);

  const job = await rpcOrThrow<JobRow | JobRow[]>(supabase, "create_upload_edit", {
    p_source_url: source,
    p_aspect: body.aspect,
    p_captions: body.captions,
  });
  const row = (Array.isArray(job) ? job[0] : job) as JobRow & { user_id: string; watermark: boolean };
  if (!row) throw new ApiError(500, "Could not create the project.");

  // A failed wake is fine: the job is already 'queued' and `sweep()` picks it up.
  after(async () => {
    await wakeWorker({
      id: row.id,
      user_id: row.user_id,
      source_url: row.source_url,
      clips_requested: row.clips_requested,
      watermark: row.watermark,
    });
  });
  return projectShape(row);
}
