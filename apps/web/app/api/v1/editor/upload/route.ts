import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { projectShape, type JobRow } from "@/lib/api/shapes";
import { createUploadEdit, createUploadEditInput } from "@/lib/editor/upload";

export const dynamic = "force-dynamic";

/** The editable clip an upload became; null until the worker publishes it. */
export type UploadEdit = ReturnType<typeof projectShape> & { clip_id: string | null; thumbnail_url: string | null };

const LIMIT = 12;

/**
 * The editor's Upload panel. POST starts a job from the user's own upload (holds credits); GET
 * lists recent uploads with the one `full` clip each becomes, so the panel can follow progress.
 */
export const POST = withApi({ body: createUploadEditInput }, async ({ supabase, user, body }) => createUploadEdit(supabase, user.id, body));

export const GET = withApi({}, async ({ supabase }) => {
  const jobs = await rpcOrThrow<JobRow[]>(supabase, "list_projects", { p_limit: LIMIT });
  const ids = jobs.map((job) => job.id);
  const clips = ids.length
    ? await supabase.from("clips").select("id, job_id, storage_path, preview_path").in("job_id", ids).eq("kind", "full")
    : { data: [], error: null };
  if (clips.error) throw new ApiError(503, "Could not load your uploads. Please try again.");
  const byJob = new Map<string, { id: string; thumbnail_url: string | null }>();
  for (const clip of (clips.data ?? []) as { id: string; job_id: string; storage_path: string | null; preview_path: string | null }[]) {
    byJob.set(clip.job_id, {
      id: clip.id,
      thumbnail_url: clip.preview_path || clip.storage_path ? `/api/v1/clips/${clip.id}/file?preview=1` : null,
    });
  }
  const items: UploadEdit[] = jobs.map((job) => {
    const clip = byJob.get(job.id);
    return { ...projectShape(job), clip_id: clip?.id ?? null, thumbnail_url: clip?.thumbnail_url ?? null };
  });
  return { items };
});
