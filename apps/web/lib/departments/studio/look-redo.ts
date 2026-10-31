/**
 * The one send-back after a failed look check (P6 S4, round 0 → round 1).
 *
 * Renders are keyed on the document's hash (`renderRequestId`), so rendering again without a change
 * returns the same task and the same file: a send-back only helps when the squad can change the edit.
 * Today that is the long take's last assembly step (`finishVideo`), which attaches voice-overs and their
 * captions that finished after the render, the usual cause of a silent or caption-less export. Shorts are
 * cut from a finished edit and slideshows already passed their own reviewer, so nothing is redone for
 * them: the card is raised at once with the note. Saying "unchanged" is the honest answer, never a
 * render that would cost the founder's daily export limit for the same file.
 */

import { finishVideo } from "./finish";
import { type LookQuestionId, type LookSendBack } from "./look-check";
import { renderEdit } from "./render";
import type { StudioContext } from "./types";

/** What a send-back did: new renders to check as round 1, or nothing to redo (raise the card now). */
export type LookRedo = { kind: "rerendered"; taskIds: string[] } | { kind: "unchanged" };

/** Failures `finishVideo` can fix: a voice-over (sound, captions) that arrived after the render. */
const FIXED_BY_FINISH: readonly LookQuestionId[] = ["sound_present", "captions_inside", "text_readable"];

/** Whether a send-back is worth trying for this card kind and these failures (no I/O). */
export function redoable(sendBack: Pick<LookSendBack, "kind">, failed: readonly LookQuestionId[]): boolean {
  return sendBack.kind === "finished_video" && failed.some((id) => FIXED_BY_FINISH.includes(id));
}

export async function redoAfterLook(ctx: StudioContext, sendBack: LookSendBack, failed: readonly LookQuestionId[]): Promise<LookRedo> {
  if (!redoable(sendBack, failed)) return { kind: "unchanged" };
  const taskIds: string[] = [];
  for (const issue of sendBack.issues) {
    const finished = await finishVideo(ctx, issue.clipId);
    // Nothing attached: the document is the same, so a render would return the same file.
    if (finished.attached === 0) continue;
    taskIds.push(await renderEdit(ctx, issue.clipId));
  }
  return taskIds.length ? { kind: "rerendered", taskIds } : { kind: "unchanged" };
}
