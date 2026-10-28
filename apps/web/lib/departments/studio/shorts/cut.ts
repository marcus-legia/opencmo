/**
 * `cutShorts` (P2 B4): the Shorts squad on an edit the founder marked finished. Segmenter, Clip
 * editor and Clip reviewer (`squad.ts`) pick the ranges; the Builder (`make_short`) makes each
 * short's own document from the finished edit, which stays untouched; A's `short_batch_create`
 * stores the batch, the short edits and their rows in one transaction, refusing an edit changed
 * since it was marked; the Renderer (`renderShort`) queues one export per short. The batch card is
 * raised by A's event rules once the renders are done.
 */

import { normalizeManifest } from "@opencmo/clip-assets";
import { makeShort, OpFailure, shotBeats, spokenWords } from "@opencmo/editor-core";

import { clipContext } from "@/lib/api/clips";
import { rpcOrThrow } from "@/lib/api/handler";
import type { LlmUsage } from "@/lib/cmo/jobs/llm";
import { readEditorProject, serverMedia, serverOpContext } from "@/lib/editor/apply";

import { renderShort } from "../render";
import type { CutShorts, ShortRange, StudioContext } from "../types";
import { pickShorts } from "./squad";

type Created = { batch_id: string; shorts: { short_id: string; short_clip_id: string }[] };

export async function cutShorts(ctx: StudioContext, clipId: string, onUsage?: (usage: LlmUsage) => Promise<void>): Promise<CutShorts> {
  const context = await clipContext(ctx.supabase, clipId);
  const project = await readEditorProject(ctx.supabase, clipId);
  const { data: finished, error } = await ctx.supabase.from("editor_projects").select("finished_hash").eq("clip_id", clipId).maybeSingle<{ finished_hash: string | null }>();
  if (error) throw new Error(`editor_projects read: ${error.message}`);
  if (!finished?.finished_hash) return { kind: "refused", message: "Mark this edit finished before cutting shorts from it." };
  if (finished.finished_hash !== project.document_hash) return { kind: "refused", message: "This edit changed after it was marked finished. Mark it finished again to cut shorts." };

  const media = await serverMedia(ctx.supabase, context, clipId, project.document, normalizeManifest(project.manifest));
  const opContext = serverOpContext(ctx.supabase, context, clipId, media);
  const words = await spokenWords(project.document, opContext);
  const beats = shotBeats(project.document, opContext);
  const { data: about } = await ctx.supabase.from("clips").select("hook").eq("id", clipId).maybeSingle<{ hook: string | null }>();
  const picked = await pickShorts({ words, beats, ...(about?.hook ? { about: about.hook } : {}) }, onUsage);
  if (typeof picked === "string") return { kind: "refused", message: picked };

  const shorts: { range: ShortRange; document: unknown }[] = [];
  for (const range of picked) {
    try {
      shorts.push({ range, document: await makeShort.apply(project.document, { start: range.start, end: range.end, name: range.title }, opContext) });
    } catch (err) {
      if (err instanceof OpFailure) return { kind: "refused", message: err.message };
      throw err;
    }
  }
  const created = await rpcOrThrow<Created>(ctx.supabase, "short_batch_create", {
    p_parent_clip_id: clipId,
    p_parent_hash: project.document_hash,
    p_order_id: ctx.orderId ?? null,
    p_shorts: shorts.map(({ range, document }) => ({ source_start: range.start, source_end: range.end, hook: range.hook, title: range.title, reason: range.reason, document })),
  });
  // Each short renders on its own; a refused render (daily limit, 20 in flight) is the order's to report.
  for (const short of created.shorts) {
    const rendered = await renderShort(ctx, short.short_clip_id);
    if (rendered.kind === "refused") console.warn(`[studio] short ${short.short_id} not rendered: ${rendered.message}`);
  }
  return {
    kind: "cut",
    batchId: created.batch_id,
    shorts: created.shorts.map((short, index) => ({ shortId: short.short_id, clipId: short.short_clip_id, range: shorts[index]!.range })),
  };
}
