import { randomUUID } from "node:crypto";

import type { ClipDocument } from "@opencmo/clip-doc";
import { readMarkers } from "@opencmo/editor-core";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, withApi } from "@/lib/api/handler";
import { ScriptBeatSchema, type ScriptBeat } from "@/lib/cmo/writer/types";
import { studioSession } from "@/lib/departments/studio/session";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
const SHOT_LABEL: Record<ScriptBeat["shot"], string> = { talking_head: "To camera", screen: "Screen", broll: "You film" };

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

  const { scope } = await studioSession(supabase, "ui", clipId);
  const { data: project } = await supabase.from("editor_projects").select("document").eq("clip_id", clipId).maybeSingle<{ document: ClipDocument }>();
  if (!project) throw new ApiError(500, "Could not open the edit. Try again.");
  // A beat whose marker is there already is not placed again, so a click after a failed one finishes the job.
  const placed = new Set(readMarkers(project.document).map((marker) => marker.name));
  let at = 0;
  for (const [index, beat] of beats.data.entries()) {
    const name = `${String(index + 1).padStart(2, "0")} · ${SHOT_LABEL[beat.shot]}`;
    if (!placed.has(name)) {
      const outcome = await scope.run({
        id: randomUUID(),
        name: "set_marker",
        input: { time: at, duration: beat.seconds, name, comment: `Say: ${beat.say}\nShow: ${beat.show}` },
      });
      if (!outcome.ok) throw new ApiError(500, "Could not place the script on the timeline. Try again.");
    }
    at += beat.seconds;
  }
  return { clipId };
});
