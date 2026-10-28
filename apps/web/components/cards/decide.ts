/**
 * Decisions on approval cards, through `POST /api/v1/approvals/[id]` (`approval_decide`). The card's
 * `contentHash` goes back with every decision, so a screen that shows an older version is refused instead of
 * approving text the founder never saw. Fixture cards (outside production only) never reach the network.
 */

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { DECIDABLE_IN_WAVE_1, type ApprovalCard } from "@/lib/screens/approval-card";

/** The actions `approval_decide` accepts, per kind (contract doc S3). */
export type Decision =
  | { action: "approve"; text?: string }
  /** `beat` (script cards): the beat whose words `text` replaces; absent, `text` is the whole draft. */
  | { action: "edit"; text: string; beat?: number }
  | { action: "skip"; reason?: string }
  | { action: "replied" }
  | { action: "dismissed"; reason?: string }
  | { action: "reject"; reason?: string }
  /** Price card (card 2): make keyframe `index` (0-based) again; a new card replaces this one. */
  | { action: "redo"; index: number }
  /** Script and price cards: stop the video here; any hold is released. */
  | { action: "cancel"; reason?: string }
  /** Finished video and shorts batch: not yet, with what to change. */
  | { action: "send_back"; reason?: string };

/** Declining spends nothing, so a card that waits on credits can still be cancelled or set aside. */
const DECLINES: ReadonlySet<Decision["action"]> = new Set(["skip", "dismissed", "reject", "cancel", "send_back"]);

/** Why the card cannot be decided here (with `action`, that decision), or null when it can. */
export function blockedReason(card: ApprovalCard, sample: boolean, action?: Decision["action"]): string | null {
  if (card.problem && !(card.problem.kind === "needs_credits" && action && DECLINES.has(action))) return card.problem.text;
  if (card.status !== "waiting") return "This card was already decided.";
  if (sample) return null;
  if (!DECIDABLE_IN_WAVE_1.has(card.kind)) return "Decisions on this card open with its department's release.";
  return null;
}

/** Sends the decision; returns the card as the server has it now. Sample cards resolve locally. */
export async function decide(card: ApprovalCard, decision: Decision, sample: boolean): Promise<ApprovalCard | null> {
  if (sample) return null;
  const reason = blockedReason(card, sample, decision.action);
  if (reason) throw new ApiError(reason, 0, null);
  const { action, ...rest } = decision;
  return api<ApprovalCard>(`/approvals/${encodeURIComponent(card.id)}`, jsonBody({ action, contentHash: card.contentHash, ...rest }));
}

/** What the toast says after a decision went through. */
export function decidedMessage(card: ApprovalCard, decision: Decision, sample: boolean): string {
  const suffix = sample ? " (sample, nothing was sent)" : "";
  switch (decision.action) {
    case "replied":
      return `Marked as replied${suffix}.`;
    case "dismissed":
      return `Dismissed${suffix}.`;
    case "skip":
      return `Skipped${suffix}.`;
    case "reject":
      return `Rejected${suffix}.`;
    case "redo":
      return `Making keyframe ${decision.index + 1} again. A new card comes when it is ready${suffix}.`;
    case "cancel":
      return `Cancelled. No credits were spent${suffix}.`;
    case "send_back":
      return card.kind === "finished_video" ? `Sent back. The edit stays open in the editor${suffix}.` : `Sent back with your note${suffix}.`;
    case "edit":
      if (card.kind === "script") return `Beat changed. The script is planned again and comes back as a new card${suffix}.`;
      return `Approved${suffix}.`;
    default:
      if (card.kind === "post" && !sample) return "Approved. Post it on X when you are ready.";
      if (card.kind === "script") return `Script approved. The keyframes are being made${suffix}.`;
      if (card.kind === "price") return `Price approved. The video is being made${suffix}.`;
      if (card.kind === "finished_video") return `Marked finished. Shorts can be cut from it${suffix}.`;
      if (card.body.kind === "shorts_batch") return `Approved ${card.body.shorts.length} shorts. They are ready to schedule${suffix}.`;
      return `Approved${suffix}.`;
  }
}
