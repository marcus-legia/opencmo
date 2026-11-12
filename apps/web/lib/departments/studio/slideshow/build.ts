/**
 * Slideshow renders (P5 B3, `studio.md` §7). The CMO no longer builds a slideshow from Writer's slides (owner,
 * 2026-11-12, D7: a slideshow is the founder's own photos); what is left renders the slideshow edits already made
 * again after a text edit (`/api/v1/studio/[clipId]/slideshow-render`), and the helpers the post image and the evals use.
 *
 * Nothing here spends credits (owner, 2026-10-30): visuals are the founder's captured pages or the Brand Kit
 * background, and an AI image is the founder's own `/image`. Text is always a layer. Every write is the founder's own
 * under RLS, through the ops.
 */

import { slideSpans, type ClipDocument } from "@opencmo/clip-doc";
import { activeScene, CAPTURE_SRC_PREFIX, SLIDE_LAYERS, SLIDE_SECONDS, SLIDE_TEXT_MAX } from "@opencmo/editor-core";

import { firstRow, rpcOrThrow } from "@/lib/api/handler";
import type { Slide } from "@/lib/cmo/writer/types";
import { readEditorProject } from "@/lib/editor/apply";
import { exportPlan, startDocumentExport } from "@/lib/editor/export";
import { wakeWorker } from "@/lib/modal";

import { renderRequestId, requestIdFrom } from "../render";
import type { StudioContext } from "../types";

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

export const stillsRequestId = (clipId: string, hash: string): string => requestIdFrom("render_stills", clipId, hash);

type CardSlide = { text: string; still_path: string; seconds: number };
type Node = { id?: string; name?: string; text?: unknown; children?: Node[] };

/** Each slide's words (heading, then the body on the next line) and length, read from the document as rendered. */
export function cardSlides(document: ClipDocument, stillPrefix: string): CardSlide[] {
  const groups = new Map(((activeScene(document) as unknown as Node).children ?? []).map((node) => [node.id, node]));
  return slideSpans(document).map((span, index) => {
    const layer = (name: string) => groups.get(span.id)?.children?.find((child) => child.name === name)?.text;
    const heading = typeof layer(SLIDE_LAYERS.heading) === "string" ? (layer(SLIDE_LAYERS.heading) as string) : "";
    const body = typeof layer(SLIDE_LAYERS.body) === "string" ? (layer(SLIDE_LAYERS.body) as string) : "";
    return {
      text: (body ? `${heading}\n${body}` : heading).slice(0, 300),
      still_path: `${stillPrefix}-${String(index + 1).padStart(2, "0")}.png`,
      seconds: Math.round((span.end - span.start) * 1e4) / 1e4,
    };
  });
}

export type SlideshowRender = { mp4TaskId: string; stillsTaskId: string; slides: CardSlide[]; mp4Path: string; pngSetPath: string };

/**
 * The MP4 and the PNG set of the slideshow as it is saved now, from one revision. Request ids follow the document, so
 * a retry gets the tasks already queued. Shared by the squad and by "render again" after the founder's edit.
 */
export async function renderSlideshow(supabase: StudioContext["supabase"], userId: string, clipId: string): Promise<SlideshowRender> {
  const project = await readEditorProject(supabase, clipId);
  const revision = await rpcOrThrow<{ id: string }>(supabase, "snapshot_editor_revision", { p_clip_id: clipId, p_document_hash: project.document_hash });
  const { resolution } = await exportPlan(supabase, userId);
  const mp4 = await startDocumentExport(supabase, clipId, revision.id, renderRequestId(clipId, project.document_hash), resolution);
  const stills = firstRow(await rpcOrThrow<{ id: string } | { id: string }[]>(supabase, "request_stills_export", { p_clip_id: clipId, p_revision_id: revision.id, p_request_id: stillsRequestId(clipId, project.document_hash) }));
  if (!stills) throw new Error("request_stills_export returned no task.");
  await wakeWorker({ task_id: stills.id });
  const prefix = `${userId}/${clipId}/${stills.id}`;
  return { mp4TaskId: mp4.id, stillsTaskId: stills.id, slides: cardSlides(project.document, prefix), mp4Path: `${userId}/${clipId}/${mp4.id}.mp4`, pngSetPath: `${prefix}.zip` };
}
