/**
 * The founder's videos, read under RLS: their projects (one upload, edited as one clip), their New edits, and a
 * project's clips. Shared by MCP's `find` group and the CMO chat's handoff tools, so both list the same things.
 */

import type { SupabaseClient } from "@/lib/api/handler";

export type ProjectRow = { id: string; name: string | null; status: string; created_at: string };
export type EditRow = { clip_id: string; name: string | null; aspect: string | null; created_at: string };
export type ClipRow = { id: string; number: number; hook: string | null; kind: string | null; seconds: number };

export async function findProjects(supabase: SupabaseClient, query: string | undefined, limits: { projects: number; edits: number }): Promise<{ projects: ProjectRow[]; edits: EditRow[] } | null> {
  const [{ data, error }, blank] = await Promise.all([
    supabase.rpc("list_projects", { p_query: query || null, p_limit: limits.projects }),
    // New edits are not projects in the app's list; under RLS this reads only the founder's own.
    supabase.from("clips").select("id, hook, created_at, jobs!inner(kind, aspect, title)").eq("kind", "blank").eq("jobs.kind", "edit").order("created_at", { ascending: false }).limit(limits.edits),
  ]);
  if (error) return null;
  const rows = (data ?? []) as { id: string; name: string | null; title: string | null; status: string; created_at: string }[];
  const edits = ((blank.data ?? []) as unknown as { id: string; hook: string | null; created_at: string; jobs: { aspect: string | null; title: string | null } }[])
    .filter((clip) => !query || `${clip.jobs.title ?? clip.hook ?? ""}`.toLowerCase().includes(query.toLowerCase()))
    .map((clip) => ({ clip_id: clip.id, name: clip.jobs.title ?? clip.hook, aspect: clip.jobs.aspect, created_at: clip.created_at }));
  return { projects: rows.map((job) => ({ id: job.id, name: job.name ?? job.title, status: job.status, created_at: job.created_at })), edits };
}

export async function findClips(supabase: SupabaseClient, projectId: string): Promise<ClipRow[] | null> {
  const { data, error } = await supabase.from("clips").select("id, idx, hook, start_seconds, end_seconds, kind").eq("job_id", projectId).order("idx");
  if (error) return null;
  return (data ?? []).map((clip) => ({
    id: clip.id as string,
    number: (clip.idx as number) + 1,
    hook: (clip.hook as string | null) ?? null,
    kind: (clip.kind as string | null) ?? null,
    seconds: Math.round((Number(clip.end_seconds) - Number(clip.start_seconds)) * 10) / 10,
  }));
}

/** Under RLS: another founder's clip id reads as missing. */
export async function clipExists(supabase: SupabaseClient, clipId: string): Promise<boolean> {
  const { data } = await supabase.from("clips").select("id").eq("id", clipId).maybeSingle();
  return Boolean(data);
}
