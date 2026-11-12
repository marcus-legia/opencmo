import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";

import { ScriptBeatSchema, type ScriptBeat } from "./writer/types";

/**
 * The script an edit was opened from (cmo-review-3 I1): the Writer's order is its one home, so the Script tab, the
 * card, the Writer screen and the prompter all read the same words. `version` is the order's `updated_at`: an edit
 * sends it back, and a stale one is refused (`cmo_script_edit_beat`).
 */
export type Script = {
  orderId: string;
  title: string;
  hooks: string[];
  beats: ScriptBeat[];
  /** The caption written with the script, to post with the recorded video; empty for a script written before captions. */
  caption: string;
  version: string;
  clipId: string;
};

const BriefSchema = z.object({
  hooks: z.array(z.string()).max(3).catch([]),
  storyboard: z.array(ScriptBeatSchema).min(1),
  caption: z.string().max(2200).catch(""),
});

/** The latest script whose edit is this clip, read under RLS; null when the edit did not come from a script. */
export async function scriptForClip(supabase: SupabaseClient, clipId: string): Promise<Script | null> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, title, brief, updated_at")
    .eq("kind", "write_video_brief")
    .eq("brief->>clip_id", clipId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; title: string | null; brief: unknown; updated_at: string }>();
  if (error) throw new ApiError(500, "Could not read the script. Try again in a minute.");
  if (!data) return null;
  const brief = BriefSchema.safeParse(data.brief);
  if (!brief.success) return null;
  return {
    orderId: data.id,
    title: data.title ?? "Your script",
    hooks: brief.data.hooks,
    beats: brief.data.storyboard,
    caption: brief.data.caption,
    version: data.updated_at,
    clipId,
  };
}

export type BeatEdit = { say?: string; show?: string };

/** One beat's new words (1-based `beat`); the answer carries the order's new version. */
export async function editBeat(supabase: SupabaseClient, orderId: string, beat: number, edit: BeatEdit, version: string) {
  return rpcOrThrow<{ version: string; beat: number; say: string; show: string }>(supabase, "cmo_script_edit_beat", {
    p_order: orderId,
    p_beat: beat,
    p_say: edit.say ?? null,
    p_show: edit.show ?? null,
    p_version: version,
  });
}
