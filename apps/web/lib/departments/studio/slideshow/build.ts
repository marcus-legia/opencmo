/**
 * The Slideshow squad (P5 B3, `studio.md` §7): Writer's slides → Reviewer (code) → Visuals → Builder (slide ops, Brand
 * Kit) → MP4 and PNG set from one revision. SQL raises the one card when both renders are done.
 *
 * Nothing here spends credits (owner, 2026-10-30): visuals are the founder's captured pages or the Brand Kit
 * background, and an AI image is the founder's own `/image`. Text is always a layer. Every write is the founder's own
 * under RLS, through the ops.
 */

import { createHash } from "node:crypto";

import { slideSpans } from "@opencmo/clip-doc";
import { CAPTURE_SRC_PREFIX, SLIDE_SECONDS, SLIDE_TEXT_MAX } from "@opencmo/editor-core";

import { clipContext } from "@/lib/api/clips";
import { firstRow, rpcOrThrow } from "@/lib/api/handler";
import { defaultBrandKit } from "@/lib/brand";
import type { Slide } from "@/lib/cmo/writer/types";
import { applyToClip, readEditorProject } from "@/lib/editor/apply";
import { exportPlan, startDocumentExport } from "@/lib/editor/export";

import { renderRequestId } from "../render";
import { SlideshowBriefSchema, type BuiltSlideshow, type SlideshowBrief, type StudioContext } from "../types";

/** Writer's own checks hold the facts and the words to avoid; this is what the frame holds, on any brief. */
export function reviewSlides(slides: readonly Slide[]): string[] {
  const issues: string[] = [];
  slides.forEach((slide, index) => {
    if (slide.heading.trim().length > SLIDE_TEXT_MAX.heading) issues.push(`Slide ${index + 1}'s heading is over ${SLIDE_TEXT_MAX.heading} characters.`);
    if (slide.body.trim().length > SLIDE_TEXT_MAX.body) issues.push(`Slide ${index + 1}'s body is over ${SLIDE_TEXT_MAX.body} characters.`);
  });
  return issues;
}

/** Long enough to read at about 3 words a second, never under 3 s. */
export function slideSeconds(slide: Slide): number {
  const words = `${slide.heading} ${slide.body}`.trim().split(/\s+/).length;
  return Math.min(SLIDE_SECONDS.max, Math.max(3, Math.ceil(words / 3)));
}

/**
 * One `add_slide` per slide. The hook and the call to action stay on the plain background, where they read best; the
 * slides between take the founder's captured pages in order, then the plain background.
 */
export function slideOps(slides: readonly Slide[], captureIds: readonly string[]) {
  const queue = [...captureIds];
  return slides.map((slide, index) => {
    const middle = index > 0 && index < slides.length - 1;
    const capture = middle ? queue.shift() : undefined;
    return {
      op: "add_slide",
      heading: slide.heading.trim(),
      ...(slide.body.trim() ? { body: slide.body.trim() } : {}),
      duration: slideSeconds(slide),
      ...(capture ? { background: { src: `${CAPTURE_SRC_PREFIX}${capture}` } } : {}),
    };
  });
}

const stillsRequestId = (clipId: string, hash: string): string => {
  const hex = createHash("sha256").update(`render_stills:${clipId}:${hash}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

async function readyCaptures(ctx: StudioContext, wanted: number): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("page_captures").select("id").eq("status", "ready").order("created_at", { ascending: false }).limit(wanted);
  if (error) throw new Error(`page_captures read: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function buildSlideshow(ctx: StudioContext, input: SlideshowBrief): Promise<BuiltSlideshow> {
  const brief = SlideshowBriefSchema.parse(input);
  const issues = reviewSlides(brief.slides);
  if (issues.length) return { kind: "invalid", message: issues.slice(0, 3).join(" ") };

  const clipId = await rpcOrThrow<string>(ctx.supabase, "create_slideshow", { p_name: brief.idea.slice(0, 60), p_aspect: brief.aspect });
  const context = await clipContext(ctx.supabase, clipId);
  const kit = await defaultBrandKit(ctx.supabase);
  // Brand last: its logo must sit on top of the slides, and it recolours what they drew.
  const ops = [...slideOps(brief.slides, await readyCaptures(ctx, brief.slides.length)), ...(kit ? [{ op: "apply_brand", kit: kit.kit, frame: false }] : [])];
  await applyToClip(ctx.supabase, context, clipId, ops, { checkpoint: null });

  const project = await readEditorProject(ctx.supabase, clipId);
  const revision = await rpcOrThrow<{ id: string }>(ctx.supabase, "snapshot_editor_revision", { p_clip_id: clipId, p_document_hash: project.document_hash });
  const { resolution } = await exportPlan(ctx.supabase, ctx.userId);
  const mp4 = await startDocumentExport(ctx.supabase, clipId, revision.id, renderRequestId(clipId, project.document_hash), resolution);
  const stills = firstRow(await rpcOrThrow<{ id: string } | { id: string }[]>(ctx.supabase, "request_stills_export", { p_clip_id: clipId, p_revision_id: revision.id, p_request_id: stillsRequestId(clipId, project.document_hash) }));
  if (!stills) throw new Error("request_stills_export returned no task.");

  const prefix = `${ctx.userId}/${clipId}/${stills.id}`;
  const spans = slideSpans(project.document);
  const card = {
    title: brief.idea.slice(0, 200),
    aspect: brief.aspect,
    slides: brief.slides.map((slide, index) => ({
      text: `${slide.heading}${slide.body ? `\n${slide.body}` : ""}`.slice(0, 300),
      still_path: `${prefix}-${String(index + 1).padStart(2, "0")}.png`,
      seconds: spans[index] ? spans[index]!.end - spans[index]!.start : slideSeconds(slide),
    })),
    mp4_path: `${ctx.userId}/${clipId}/${mp4.id}.mp4`,
    png_set_path: `${prefix}.zip`,
  };
  await rpcOrThrow(ctx.supabase, "studio_slideshow_rendering", {
    p_order_id: ctx.orderId ?? null,
    p_clip_id: clipId,
    p_input: { idea: brief.idea, aspect: brief.aspect },
    p_card: card,
    p_mp4_task: mp4.id,
    p_stills_task: stills.id,
  });
  return { kind: "rendering", clipId, mp4TaskId: mp4.id, stillsTaskId: stills.id };
}
