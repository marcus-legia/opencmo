import { readMarkers } from "@opencmo/editor-core";
import { z } from "zod";

import { clipContext } from "@/lib/api/clips";
import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi, type SupabaseClient } from "@/lib/api/handler";
import { scriptMarkers } from "@/lib/cmo/script-markers";
import { ScriptBeatSchema, type ScriptBeat } from "@/lib/cmo/writer/types";
import { applyToClip, readEditorProject } from "@/lib/editor/apply";
import { ensureProject } from "@/lib/editor/project";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
async function placeMarkers(supabase: SupabaseClient, clipId: string, beats: readonly ScriptBeat[]): Promise<void> {
  const context = await clipContext(supabase, clipId);
  await ensureProject(supabase, context, clipId);
  // One write with the version it read: two opens at once cannot both place the beats; the loser reads again and finds
  // them there.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const project = await readEditorProject(supabase, clipId);
    const placed = new Set(readMarkers(project.document).map((marker) => marker.name));
    const ops = scriptMarkers(beats).filter((op) => !placed.has(op.name));
    if (!ops.length) return;
    try {
      await applyToClip(supabase, context, clipId, ops, { expectedVersion: project.version, checkpoint: { kind: "agent", label: "Script" } });
      return;
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409) || attempt === 1) throw error;
    }
  }
}

/**
 * "Open in editor" on an approved script (owner, 2026-11-09): the founder records the video themselves. One blank edit
 * per script (`cmo_script_open`), with one marker per beat at its time: what to say and what to show. A second click
 * opens the same edit.
 */
export const POST = withApi({ rateLimit: { bucket: "project-write", limit: 60, windowSeconds: 3600 } }, async ({ supabase, params }) => {
  if (!UUID.test(params.id ?? "")) throw new ApiError(404, "Script not found.");
  const clipId = await rpcOrThrow<string>(supabase, "cmo_script_open", { p_order: params.id });
  const { data: order, error } = await supabase.from("work_orders").select("brief").eq("id", params.id).maybeSingle<{ brief: { storyboard?: unknown } }>();
  if (error || !order) throw new ApiError(404, "Script not found.");
  const beats = z.array(ScriptBeatSchema).safeParse(order.brief.storyboard);
  if (!beats.success) throw new ApiError(422, "This script has no beats to place.");
  await placeMarkers(supabase, clipId, beats.data);
  return { clipId };
});
