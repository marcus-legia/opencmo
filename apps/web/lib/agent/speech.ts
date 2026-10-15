/**
 * The clip's videos with speech, as the Assistant sees them: which one a transcript tool read, and
 * what to say when a video has no transcript yet (still transcribing, or never will be on its own).
 *
 * Pure apart from `statuses`, which the workspace answers from `media_assets.transcript_status`
 * (Track A); without it no video is ever "pending", so the answer falls back to add_captions.
 */

import type { Manifest } from "@opencmo/clip-assets";
import type { ClipDocument } from "@opencmo/clip-doc";
import { MASTER_SRC, round, speechSources, walk } from "@opencmo/editor-core";

/** `media_assets.transcript_status` by media id; a missing id is "unknown". */
export type TranscriptStatuses = (mediaIds: string[]) => Promise<Record<string, string>>;

/** A video on the timeline that plays a library file (not the master), with that file's media id. */
export type MediaVideo = { id: string; name: string; mediaId: string | null };

const PENDING = new Set(["queued", "running"]);

type Paint = { type?: unknown; src?: unknown };

/** Every video of the clip that plays a library file: a `video`, or a `rect` painted with one. */
export function libraryVideos(document: ClipDocument, manifest: Manifest): MediaVideo[] {
  const out: MediaVideo[] = [];
  walk(document, ({ entity, tag }) => {
    const src = tag === "video" ? entity.src : tag === "rect" ? ((entity.paints as Paint[] | undefined) ?? []).find((paint) => paint.type === "video")?.src : undefined;
    if (typeof src !== "string" || src === MASTER_SRC || typeof entity.id !== "string") return;
    const record = manifest.assets.find((item) => item.path === src);
    const cloud = record?.cloud as { mediaId?: unknown } | undefined;
    const name = typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : (src.split("/").pop() ?? src);
    out.push({ id: entity.id, name, mediaId: typeof cloud?.mediaId === "string" ? cloud.mediaId : null });
  });
  return out;
}

/** Library videos whose automatic transcript is queued or running. */
export async function transcribing(videos: MediaVideo[], statuses: TranscriptStatuses | undefined): Promise<MediaVideo[]> {
  const ids = [...new Set(videos.map((video) => video.mediaId).filter((id): id is string => Boolean(id)))];
  if (!ids.length || !statuses) return [];
  const found = await statuses(ids).catch(() => ({}) as Record<string, string>);
  return videos.filter((video) => video.mediaId && PENDING.has(found[video.mediaId] ?? ""));
}

export const speechCount = (document: ClipDocument): number => speechSources(document).length;

/** The source a transcript tool read: the one asked for, else the master, else the only one. */
export function sourceOf(document: ClipDocument, elementId?: string): { element_id: string; name: string; main?: true } | null {
  const list = speechSources(document);
  const found = elementId ? list.find((source) => source.elementId === elementId) : (list.find((source) => source.master) ?? list[0]);
  if (found) return { element_id: found.elementId, name: found.name, ...(found.master ? { main: true as const } : {}) };
  // A segment id of a cut sequence: still that video, named by the id the model passed.
  return elementId ? { element_id: elementId, name: elementId } : null;
}

/**
 * What a transcript tool answers when there is nothing to read. `null` = `elementId` names no
 * video at all; the caller reports its own error then.
 */
export async function noTranscript(
  document: ClipDocument,
  manifest: Manifest,
  statuses: TranscriptStatuses | undefined,
  elementId?: string,
): Promise<{ ok: true; content: string; summary: string } | null> {
  const videos = libraryVideos(document, manifest);
  const target = elementId ? videos.find((video) => video.id === elementId) : undefined;
  if (elementId && !target) return null;
  const candidates = target ? [target] : videos;
  const pending = await transcribing(candidates, statuses);
  const list = (items: MediaVideo[]) => items.map((video) => ({ element_id: video.id, name: video.name }));
  if (pending.length) {
    return {
      ok: true,
      content: JSON.stringify({
        captions: null,
        transcript: "pending",
        videos: list(pending),
        next: "This video is still being transcribed (about a minute). Try again shortly; do not pay for add_captions.",
      }),
      summary: "Still transcribing",
    };
  }
  return {
    ok: true,
    content: JSON.stringify({
      captions: null,
      transcript: "none",
      ...(candidates.length ? { videos: list(candidates) } : {}),
      next: candidates.length
        ? "This video has no transcript. Offer the user add_captions with its element_id to transcribe it, then cut it by its words."
        : "This clip has no video with speech.",
    }),
    summary: "No transcript",
  };
}

/** The `speech_sources` of <clip_context>: every video that can be cut by words, and those still transcribing. */
export async function speechContext(
  document: ClipDocument,
  readTranscript: (src: string) => Promise<unknown>,
  pending: MediaVideo[] = [],
): Promise<Array<Record<string, unknown>>> {
  const sources = await Promise.all(
    speechSources(document).map(async (source) => {
      let words: number | string = "transcribing…";
      if (source.transcript) {
        const transcript = (await readTranscript(source.transcript).catch(() => null)) as Array<{ words?: { start: number }[] }> | null;
        const all = (transcript ?? []).flatMap((segment) => segment.words ?? []);
        words = source.window ? all.filter((word) => word.start >= source.window!.start && word.start < source.window!.end).length : all.length;
      }
      return {
        name: source.name,
        id: source.elementId,
        ...(source.master ? { main: true } : {}),
        duration: source.window ? round(source.window.end - source.window.start) : null,
        words,
      };
    }),
  );
  const listed = new Set(sources.map((source) => source.id));
  return [...sources, ...pending.filter((video) => !listed.has(video.id)).map((video) => ({ name: video.name, id: video.id, words: "transcribing…" }))];
}
