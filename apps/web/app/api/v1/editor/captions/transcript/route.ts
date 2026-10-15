import { z } from "zod";

import { withApi } from "@/lib/api/handler";
import { loadMediaTranscript, requestMediaTranscript } from "@/lib/editor/captions-run";

export const dynamic = "force-dynamic";

const body = z.union([
  z.object({
    clip_id: z.string().uuid(),
    media_id: z.string().uuid(),
    source_in: z.number().min(0).default(0),
    source_out: z.number().positive().nullable().optional(),
  }),
  // A file uploaded before automatic transcripts, or whose run failed: ask again, free, same daily cap.
  z.object({ media_id: z.string().uuid(), request: z.literal(true) }),
]);

/**
 * A library file's automatic transcript (own-video editing, Track A), free:
 * - `{clip_id, media_id, source_in, source_out}` → the transcript sliced to that window and stored for the
 *   clip: `{status:"ready",src,hash}` | `{status:"pending"}` | `{status:"none"}`;
 * - `{media_id, request: true}` → `{transcript_status}` after asking for it.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "editor-write", limit: 240, windowSeconds: 60 } },
  async ({ supabase, body }) => {
    if ("request" in body) return { transcript_status: await requestMediaTranscript(supabase, body.media_id) };
    return loadMediaTranscript(supabase, {
      clipId: body.clip_id,
      mediaId: body.media_id,
      sourceIn: body.source_in,
      sourceOut: body.source_out ?? null,
    });
  },
);
