import "server-only";

/**
 * Tạo job cắt clip (G1-b): MỘT đường cho editor (`/api/v1/editor/clipping`) và route cũ
 * (`/api/v1/jobs`). Kiểm sớm ở đây để câu lỗi nói đúng chỗ sai; `create_clip_job()` kiểm
 * lại y hệt và nó mới là chốt thật — kể cả xác nhận chính chủ cho link (luật 3).
 */

import { after } from "next/server";

import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { projectShape, type JobRow } from "@/lib/api/shapes";
import { sourceProblem } from "@/lib/api/source";
import { wakeWorker } from "@/lib/modal";
import { ASPECTS, JOB_LAYOUTS } from "@/lib/settings-schema";

import { MAX_SEGMENTS, segmentProblem } from "./segments";

export { segmentProblem } from "./segments";

const NO_MOMENTS = "Pick at least one moment to clip.";

const segment = z.object({
  start: z.number().min(0).finite(),
  end: z.number().min(0).finite(),
});

export const createClipJobInput = z.object({
  source: z.string().min(1).max(2000),
  // Kept for old callers: the clip count is always the number of moments.
  clips: z.number().int().min(1).max(10).default(5),
  clip_length: z.enum(["auto", "short", "medium", "long"]).default("auto"),
  /** The moments the user picked on the picker; a clip job needs at least one (plan decision 8). */
  segments: z.array(segment).max(MAX_SEGMENTS).optional(),
  /** "full" tải nguyên video, không cắt và không burn phụ đề. */
  mode: z.enum(["clip", "full"]).default("clip"),
  // Danh sách lấy từ `settings-schema`: revision và job phải nói cùng một bộ giá trị.
  aspect: z.enum(ASPECTS).default("9:16"),
  layout: z.enum(JOB_LAYOUTS).default("auto"),
  // Chỉ bật/tắt: pipeline đốt một kiểu cố định, kiểu khác chọn trong editor (R4).
  captions: z.boolean().default(true),
  /** Người dùng tick "This is my own video" — bắt buộc với link, SQL kiểm lại. */
  ownership_confirmed: z.boolean().default(false),
}).superRefine((body, ctx) => {
  // First of three gates (zod → `create_job()` → worker): AI moment picking is gone, so a clip job
  // with no moments has nothing to cut.
  if (body.mode === "clip" && !body.segments?.length) ctx.addIssue({ code: "custom", message: NO_MOMENTS });
});
export type CreateClipJobInput = z.infer<typeof createClipJobInput>;

// Không rate limit ở route: `create_job()` tự gọi `rate_limit_hit('jobs', 10, 3600)` —
// đếm hai chỗ là mười job thật thành năm.
export async function createClipJob(supabase: SupabaseClient, userId: string, body: CreateClipJobInput) {
  const source = body.source.trim();
  const problem = sourceProblem(source, userId);
  if (problem) throw new ApiError(422, problem);
  if (!source.startsWith("storage://") && !body.ownership_confirmed) {
    throw new ApiError(422, "Confirm this is your own video to continue.");
  }

  const segments = body.segments?.length ? body.segments : null;
  if (body.mode === "full" && segments) {
    throw new ApiError(422, "Picked moments only apply when we clip your video.");
  }
  if (body.mode === "clip" && !segments) throw new ApiError(422, NO_MOMENTS);
  if (segments) {
    const trouble = segmentProblem(segments);
    if (trouble) throw new ApiError(422, trouble);
  }

  // Trừ credit + tạo job + ghi xác nhận chính chủ: một giao dịch (ràng buộc web số 1).
  const job = await rpcOrThrow<JobRow | JobRow[]>(supabase, "create_clip_job", {
    p_source_url: source,
    p_clips: segments ? segments.length : body.clips,
    p_length: body.clip_length,
    p_segments: segments,
    p_mode: body.mode,
    p_aspect: body.aspect,
    p_layout: body.layout,
    p_captions: body.captions,
    p_ownership_confirmed: body.ownership_confirmed,
  });
  const row = (Array.isArray(job) ? job[0] : job) as JobRow & { user_id: string; watermark: boolean };
  if (!row) throw new ApiError(500, "Could not create the project.");

  // Đánh thức worker. Hỏng cũng không sao: job đã ở 'queued', `sweep()` nhặt khi có thể.
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
