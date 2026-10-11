/**
 * Tạo một generation — MỘT đường cho route `/api/v1/generations` và tool
 * `generate_media` của Assistant: kiểm spec theo catalog (lớp 1), băm JCS,
 * `create_generation` (lớp 2: giá, quyền, đặt trước credit + task cùng giao
 * dịch), đánh thức worker.
 */

import { MASTER_SRC } from "@opencmo/editor-core";
import { specSchema, type AiModel, type GenerationSpec } from "@opencmo/editor-core/generate";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { wakeWorker } from "@/lib/modal";

import { availableModel, loadCatalog, specHash, type GenerationRow } from "./models";
import { moderateText, specText } from "./moderation";

export type CreateRequest = {
  jobId: string;
  clipId: string | null;
  model: string;
  spec: unknown;
  requestId: string;
};

/** Spec đã qua schema của model — thứ được băm và lưu. Ném 422 tiếng Anh. */
export function normalizeSpec(model: AiModel, spec: unknown): GenerationSpec {
  const parsed = specSchema(model).safeParse(spec);
  if (!parsed.success) throw new ApiError(422, parsed.error.issues[0]?.message ?? "Invalid generation request.");
  // Trường theo khả năng model ghép bằng spread có điều kiện: zod đã kiểm, kiểu suy ra thì quá rộng.
  return parsed.data as GenerationSpec;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_KEYS = ["startImage", "endImage"] as const;

/**
 * Ảnh đầu vào gửi lên dạng id (asset media hoặc lượt sinh đã xong) → tên object trong
 * bucket `media`. Đọc DƯỚI RLS và theo đúng project: id của người khác hay project khác
 * không ra đường dẫn nào. SQL vẫn kiểm chủ sở hữu + tồn tại (`ai_media_ref_ok`).
 */
export async function resolveMediaRefs(supabase: SupabaseClient, jobId: string, spec: unknown): Promise<unknown> {
  if (!spec || typeof spec !== "object") return spec;
  const input = spec as Record<string, unknown>;
  const toPath = async (value: unknown, noun = "image"): Promise<unknown> => {
    if (typeof value !== "string" || !UUID.test(value)) return value;
    const asset = await supabase.from("media_assets").select("storage_path, status").eq("id", value).eq("job_id", jobId).maybeSingle<{ storage_path: string; status: string }>();
    // Ảnh người dùng upload còn đang probe: chưa chắc là ảnh đọc được.
    if (asset.data?.status === "pending") throw new ApiError(422, `That ${noun} is still uploading. Try again in a moment.`);
    let path = asset.data?.status === "ready" ? asset.data.storage_path : undefined;
    if (!path) {
      const generation = await supabase.from("generations").select("media_asset_id, status").eq("id", value).eq("job_id", jobId).maybeSingle<{ media_asset_id: string | null; status: string }>();
      if (generation.data && generation.data.status !== "done") throw new ApiError(422, `That ${noun} is still generating. Try again when it is ready.`);
      if (generation.data?.media_asset_id) {
        const linked = await supabase.from("media_assets").select("storage_path").eq("id", generation.data.media_asset_id).maybeSingle<{ storage_path: string }>();
        path = linked.data?.storage_path;
      }
    }
    if (!path) throw new ApiError(422, `That ${noun} was not found in your library.`);
    return path.replace(/^media\//, "");
  };
  const out: Record<string, unknown> = { ...input };
  for (const key of IMAGE_KEYS) if (key in out) out[key] = await toPath(out[key]);
  if (Array.isArray(out.references)) out.references = await Promise.all(out.references.map((ref) => toPath(ref)));
  if ("sourceVideo" in out) out.sourceVideo = await toPath(out.sourceVideo, "video");
  return out;
}

/**
 * The document names the clip's own video `assets/master.mp4`; background removal reads it from
 * storage as `<bucket>:<object>` (master in `renders`, or the 540p proxy in `sources`). Read under RLS,
 * so another user's clip resolves to nothing. SQL checks the owner and the object again.
 */
async function resolveClipVideo(supabase: SupabaseClient, request: CreateRequest, spec: unknown): Promise<unknown> {
  const input = spec as Record<string, unknown> | null;
  if (!input || input.sourceVideo !== MASTER_SRC) return spec;
  if (!request.clipId) throw new ApiError(422, "Choose a video from your library to edit.");
  const job = await supabase.from("jobs").select("media_manifest").eq("id", request.jobId).maybeSingle<{ media_manifest: unknown }>();
  const manifest = (job.data?.media_manifest ?? {}) as { masters?: Record<string, { bucket?: string; object?: string }>; proxies?: Record<string, { bucket?: string; object?: string }> };
  const entry = manifest.masters?.[request.clipId] ?? manifest.proxies?.[request.clipId];
  if (!entry?.bucket || !entry.object) throw new ApiError(422, "This clip has no editable source yet. Process the video again to edit it.");
  return { ...input, sourceVideo: `${entry.bucket}:${entry.object}` };
}

export async function createGeneration(
  supabase: SupabaseClient,
  request: CreateRequest,
): Promise<{ generation: GenerationRow & { task_id?: string }; reused: boolean }> {
  await loadCatalog(supabase);
  const model = availableModel(request.model);
  if (!model) throw new ApiError(422, "This model is not available.");
  const spec = normalizeSpec(model, await resolveClipVideo(supabase, request, await resolveMediaRefs(supabase, request.jobId, request.spec)));
  // Kiểm lời TRƯỚC khi đặt credit: bị chặn thì không tốn gì, không có task nào.
  await moderateText(specText(spec).join("\n"));
  const result = await rpcOrThrow<{ generation: GenerationRow & { task_id?: string }; reused: boolean }>(
    supabase,
    "create_generation",
    {
      p_job_id: request.jobId,
      p_clip_id: request.clipId,
      p_model: model.id,
      p_spec: spec,
      p_spec_hash: specHash(model.id, spec),
      p_request_id: request.requestId,
    },
  );
  if (!result.reused && result.generation.task_id) await wakeWorker({ task_id: result.generation.task_id });
  return result;
}
