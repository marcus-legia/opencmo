/**
 * `finishVideo` (P2, found in A6): what the open editor does when a long take's voice arrives, done
 * on the server for an edit nobody opens. The editor's `useVoiceovers` runs `sync_voiceover` once the
 * voice generation is a file (real length, word timings → the voice-over captions get their
 * transcript); a brain order never opens an editor, so its video rendered without captions and the
 * Shorts squad found no words. Same op, same write path (`applyToClip`), no Version history step:
 * bookkeeping, as in the editor. Idempotent: a synced voice-over is skipped.
 */

import { isDeepStrictEqual } from "node:util";

import { VOICEOVER_MARK, walk, type VoiceoverMark } from "@opencmo/editor-core";

import { clipContext } from "@/lib/api/clips";
import { applyToClip, readEditorProject } from "@/lib/editor/apply";

import type { StudioContext } from "./types";

/** The fields a declaration pins, as the export worker's `_SPEC_FIELDS` (voice-overs use a few). */
const SPEC_FIELDS = ["aspectRatio", "duration", "seed", "voice", "scene", "resolution", "audio", "refs", "after"] as const;

type Row = { id: string; model: string; spec: Record<string, unknown> | null; media_asset_id: string | null };
type Word = { text: string; start: number; end: number };

/** A finished generation of this declaration: same prompt, model and every pinned field (the worker's rule). */
export function voiceRowMatches(declaration: Record<string, unknown>, row: Pick<Row, "model" | "spec">): boolean {
  const spec = row.spec ?? {};
  if (spec.prompt !== declaration.prompt) return false;
  if ("model" in declaration && row.model !== declaration.model) return false;
  return SPEC_FIELDS.every((name) => !(name in declaration) || isDeepStrictEqual(spec[name], declaration[name]));
}

/** Voice-overs still waiting for their voice on the edit's document. */
export function pendingVoiceovers(document: Parameters<typeof walk>[0]): { key: string; src: Record<string, unknown> }[] {
  const waiting: { key: string; src: Record<string, unknown> }[] = [];
  walk(document, ({ entity, tag }) => {
    if (tag !== "audio") return;
    const mark = (entity.marks as Record<string, unknown> | undefined)?.[VOICEOVER_MARK] as VoiceoverMark | undefined;
    const src = entity.src as Record<string, unknown> | undefined;
    if (!mark || mark.synced || !src || typeof src !== "object" || src.generate !== "voice") return;
    waiting.push({ key: mark.key, src });
  });
  return waiting;
}

/** Attaches every voice that is done; `waiting` counts voice-overs whose voice is not a file yet. */
export async function finishVideo(ctx: StudioContext, clipId: string): Promise<{ attached: number; waiting: number }> {
  const context = await clipContext(ctx.supabase, clipId);
  const project = await readEditorProject(ctx.supabase, clipId);
  const pending = pendingVoiceovers(project.document);
  if (!pending.length) return { attached: 0, waiting: 0 };

  const { data, error } = await ctx.supabase.from("generations").select("id, model, spec, media_asset_id").eq("job_id", context.clip.job_id).eq("status", "done");
  if (error) throw new Error(`generations read: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const ops: { op: "sync_voiceover"; key: string; duration: number; words?: Word[] }[] = [];
  for (const { key, src } of pending) {
    const row = rows.find((candidate) => candidate.media_asset_id && voiceRowMatches(src, candidate));
    if (!row) continue;
    const { data: asset, error: assetError } = await ctx.supabase.from("media_assets").select("duration, words").eq("id", row.media_asset_id!).maybeSingle<{ duration: number | string | null; words: Word[] | null }>();
    if (assetError) throw new Error(`media_assets read: ${assetError.message}`);
    const duration = Number(asset?.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    ops.push({ op: "sync_voiceover", key, duration, ...(asset?.words?.length ? { words: asset.words } : {}) });
  }
  if (ops.length) await applyToClip(ctx.supabase, context, clipId, ops, { checkpoint: null });
  return { attached: ops.length, waiting: pending.length - ops.length };
}
