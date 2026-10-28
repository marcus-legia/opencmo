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
  | { action: "edit"; text: string }
  | { action: "skip"; reason?: string }
  | { action: "replied" }
  | { action: "dismissed"; reason?: string }
  | { action: "reject"; reason?: string };

/** Why the card cannot be decided here, or null when it can. */
export function blockedReason(card: ApprovalCard, sample: boolean): string | null {
  if (card.problem) return card.problem.text;
  if (card.status !== "waiting") return "This card was already decided.";
  if (sample) return null;
  if (!DECIDABLE_IN_WAVE_1.has(card.kind)) return "Decisions on this card open with its department's release.";
  return null;
}

/** Sends the decision; returns the card as the server has it now. Sample cards resolve locally. */
export async function decide(card: ApprovalCard, decision: Decision, sample: boolean): Promise<ApprovalCard | null> {
  if (sample) return null;
  const reason = blockedReason(card, sample);
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
    default:
      if (card.kind === "post" && !sample) return "Approved. Post it on X when you are ready.";
      return `Approved${suffix}.`;
  }
}
