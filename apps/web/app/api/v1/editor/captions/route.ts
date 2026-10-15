import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { notFound, rpcOrThrow, withApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export type MediaCaptions = { task_id: string; credits: number };
export type MediaCaptionsStatus = { status: string; error: string | null; output: { hash?: string; src?: string } | null };

const body = z.object({
  clip_id: z.string().uuid(),
  media_id: z.string().uuid(),
  source_in: z.number().min(0).optional(),
  source_out: z.number().positive().optional(),
  request_id: z.string().uuid().optional(),
});

/**
 * Phụ đề cho một file thư viện (E4-e): trừ 1 credit/phút của đoạn đang dùng rồi xếp task
 * `transcribe_media` cho worker. Hỏng thì trigger SQL hoàn credit — route không giữ tiền.
 */
export const POST = withApi(
  { body, rateLimit: { bucket: "editor-write", limit: 240, windowSeconds: 60 } },
  async ({ supabase, body }) =>
    rpcOrThrow<MediaCaptions>(supabase, "request_media_captions", {
      p_clip_id: body.clip_id,
      p_media_id: body.media_id,
      p_source_in: body.source_in ?? 0,
      p_source_out: body.source_out ?? null,
      p_request_id: body.request_id ?? null,
    }),
);

export type TranscriptStatuses = {
  media: { id: string; transcript_status: string; probed: boolean; has_audio: boolean | null }[];
};

/** Ids per status request: the editor polls a library's files in pages of this size. */
const MAX_MEDIA_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Two reads under RLS:
 * - `?task=<id>`: a captions task; `done` carries `output.src` for the captions layer, `failed` an English error.
 * - `?media_ids=<id>,…`: the automatic transcript status of library files (own-video editing, Track A), with
 *   whether the probe is done (`probed`) and the file has audio.
 *   Unknown or foreign ids are left out.
 */
export const GET = withApi({}, async ({ supabase, request }) => {
  const mediaIds = request.nextUrl.searchParams.get("media_ids");
  if (mediaIds !== null) {
    const ids = [...new Set(mediaIds.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean))];
    if (ids.length > MAX_MEDIA_IDS || ids.some((id) => !UUID.test(id))) {
      throw new ApiError(400, `Send up to ${MAX_MEDIA_IDS} file ids.`);
    }
    if (!ids.length) return { media: [] } satisfies TranscriptStatuses;
    const { data, error } = await supabase.from("media_assets").select("id, status, has_audio, transcript_status").in("id", ids);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; status: string; has_audio: boolean | null; transcript_status: string }[];
    // `probed`: the worker has measured the file; until then `none` only means "not decided yet".
    return {
      media: rows.map((row) => ({ id: row.id, transcript_status: row.transcript_status, probed: row.status !== "pending", has_audio: row.has_audio })),
    } satisfies TranscriptStatuses;
  }
  const taskId = request.nextUrl.searchParams.get("task") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(taskId)) throw notFound("Task not found.");
  const { data } = await supabase.from("tasks").select("status, error, output").eq("id", taskId).eq("kind", "transcribe_media").maybeSingle();
  if (!data) throw notFound("Task not found.");
  return data as MediaCaptionsStatus;
});
