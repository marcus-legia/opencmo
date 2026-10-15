/**
 * The editor's side of automatic transcripts (Track A writes them): the status of library files,
 * and a file transcript sliced to one element's window. Both go through the captions route under
 * RLS; the slicing itself is `use_media_transcript` (`lib/editor/captions-run.ts`), shared with the
 * Assistant so the two cannot diverge.
 *
 * A 404 means the server has no automatic transcripts (yet): callers stop asking and the editor
 * behaves as before.
 */

import { ApiError, api, jsonBody } from "@/components/clipping/api";

export type TranscriptStatus = "none" | "queued" | "running" | "ready" | "failed" | "skipped";

export type MediaTranscript = { status: "ready"; src: string; hash: string } | { status: "pending" } | { status: "none" };

/** Ids per request: the route caps the list. */
const BATCH = 50;

export class TranscriptsUnavailable extends Error {}

const unavailable = (error: unknown): never => {
  if (error instanceof ApiError && error.status === 404) throw new TranscriptsUnavailable("Automatic transcripts are not available.");
  throw error;
};

export type FileTranscript = { status: TranscriptStatus; probed: boolean; hasAudio: boolean | null };

/** The automatic transcript of each library file; files the server does not know are left out. */
export async function transcriptStatuses(mediaIds: string[]): Promise<Map<string, FileTranscript>> {
  const out = new Map<string, FileTranscript>();
  for (let index = 0; index < mediaIds.length; index += BATCH) {
    const ids = mediaIds.slice(index, index + BATCH);
    const page = await api<{ media?: { id: string; transcript_status: TranscriptStatus; probed?: boolean; has_audio?: boolean | null }[] }>(
      `/editor/captions?media_ids=${ids.map(encodeURIComponent).join(",")}`,
    ).catch(unavailable);
    for (const item of page.media ?? []) {
      out.set(item.id, { status: item.transcript_status, probed: item.probed ?? true, hasAudio: item.has_audio ?? null });
    }
  }
  return out;
}

/** Asks for the free transcript of a file that has none (uploaded before automatic transcripts, or failed). */
export async function requestTranscript(mediaId: string): Promise<TranscriptStatus> {
  const out = await api<{ transcript_status: TranscriptStatus }>("/editor/captions/transcript", jsonBody({ media_id: mediaId, request: true })).catch(unavailable);
  return out.transcript_status;
}

/** The file's transcript for `[sourceIn, sourceOut)`, stored for this clip (file seconds). */
export function mediaTranscript(input: { clipId: string; mediaId: string; sourceIn: number; sourceOut: number }): Promise<MediaTranscript> {
  return api<MediaTranscript>(
    "/editor/captions/transcript",
    jsonBody({ clip_id: input.clipId, media_id: input.mediaId, source_in: input.sourceIn, source_out: input.sourceOut }),
  ).catch(unavailable);
}
