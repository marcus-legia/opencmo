/**
 * Mark finished and Cut shorts from Studio (P2 C2), over B5's routes. The hash sent is the one the loader read with
 * the edit (`StudioItem.documentHash`, `editStates`): if the edit changed since, the server answers 409 with a sentence
 * and nothing is marked. Shorts are cut only from an edit finished at its current document.
 */

import { api, jsonBody } from "@/components/clipping/api";
import type { StudioScreen } from "@/lib/screens/studio";

export type EditState = StudioScreen["editStates"][number];

export function markFinished(clipId: string, documentHash: string): Promise<{ finishedAt: string; documentHash: string }> {
  return api(`/studio/${encodeURIComponent(clipId)}/finished`, jsonBody({ documentHash }));
}

export function cutShorts(clipId: string): Promise<{ orderId: string }> {
  return api(`/studio/${encodeURIComponent(clipId)}/shorts`, jsonBody({}));
}

/** Finished at the document it has now: a later edit changed the hash, and the mark no longer counts. */
export const isFinished = (state: EditState | undefined): boolean => !!state?.finishedAt;
