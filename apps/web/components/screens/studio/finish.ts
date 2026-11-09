/**
 * Mark finished and Cut shorts from Studio (P2 C2), over B5's routes. The hash sent is the one the loader read with
 * the edit (`StudioItem.documentHash`, `editStates`): if the edit changed since, the server answers 409 with a sentence
 * and nothing is marked. Shorts are cut only from an edit finished at its current document.
 */

import { api, jsonBody } from "@/components/clipping/api";
import type { StudioScreen } from "@/lib/screens/studio";

export type EditState = StudioScreen["editStates"][number];

export type Finished = { finishedAt: string; documentHash: string; posting: "rendering" | "refused" | "none"; postingNote?: string };

export function markFinished(clipId: string, documentHash: string): Promise<Finished> {
  return api(`/studio/${encodeURIComponent(clipId)}/finished`, jsonBody({ documentHash }));
}

/** What Mark finished started (C2), in the same words in the editor and in Studio. */
export function finishedNote(done: Finished): { text: string; error: boolean } {
  if (done.posting === "rendering") return { text: "Marked finished. It is rendering for posting: its card comes to your Dashboard, then you pick when it posts. 3 shorts are cut from it too.", error: false };
  if (done.posting === "refused") return { text: `Marked finished, but it could not be rendered for posting: ${done.postingNote ?? "try again later."}`, error: true };
  return { text: "Marked finished. Shorts can be cut from it.", error: false };
}

export function cutShorts(clipId: string): Promise<{ orderId: string }> {
  return api(`/studio/${encodeURIComponent(clipId)}/shorts`, jsonBody({}));
}

/** Finished at the document it has now: a later edit changed the hash, and the mark no longer counts. */
export const isFinished = (state: EditState | undefined): boolean => !!state?.finishedAt;
