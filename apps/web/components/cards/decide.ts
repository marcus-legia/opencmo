/**
 * Decisions on approval cards. Real cards call today's routes (each one an ownership-checking RPC); Session A's
 * `approval_decide` (A0) replaces them behind the same function. Fixture cards never reach the network.
 */

import { ApiError, api, jsonBody } from "@/components/clipping/api";

import type { ApprovalCardView, CardKind } from "./model";

export type Decision =
  | { action: "approve"; text?: string }
  | { action: "skip"; reason?: string }
  | { action: "replied" };

/** Kinds whose decision works today; the rest wait for their phase (A1 Studio cards, P1 schedule, B0 corrections). */
export const LIVE_KINDS: ReadonlySet<CardKind> = new Set(["post", "reply", "goal"]);

/** Why the card cannot be decided here, or null when it can. */
export function blockedReason(card: ApprovalCardView): string | null {
  if (card.state !== "waiting") return card.stateNote ?? "This card is no longer waiting.";
  if (card.sample) return null;
  if (!LIVE_KINDS.has(card.kind) || !card.ref) return "Decisions on this card open with its department's release.";
  return null;
}

export async function decide(card: ApprovalCardView, decision: Decision): Promise<void> {
  if (card.sample) return;
  const reason = blockedReason(card);
  if (reason || !card.ref) throw new ApiError(reason ?? "This card cannot be decided here.", 0, null);
  const { kind, id } = card.ref;
  const path = encodeURIComponent(id);
  if (kind === "content_item") {
    if (decision.action === "replied") throw new ApiError("A post is approved or skipped.", 0, null);
    await api(`/cmo/items/${path}`, jsonBody(decision.action === "approve" ? { action: "approve", text: decision.text } : { action: "skip", reason: decision.reason }));
  } else if (kind === "opportunity") {
    if (decision.action === "approve") throw new ApiError("You post Reddit replies yourself: mark it replied or dismiss it.", 0, null);
    await api(`/cmo/opportunities/${path}`, jsonBody(decision.action === "replied" ? { action: "replied" } : { action: "dismissed", reason: decision.reason }));
  } else {
    if (decision.action === "replied") throw new ApiError("A goal is approved or rejected.", 0, null);
    await api(`/cmo/goals/${path}`, jsonBody({ action: decision.action === "approve" ? "approve" : "reject" }));
  }
}

/** What the toast says after a decision went through. */
export function decidedMessage(card: ApprovalCardView, decision: Decision): string {
  const sample = card.sample ? " (sample, nothing was sent)" : "";
  if (decision.action === "replied") return `Marked as replied${sample}.`;
  if (decision.action === "skip") return `${card.kind === "reply" ? "Dismissed" : "Skipped"}${sample}.`;
  if (card.kind === "post" && !card.sample) return "Approved. Post it on X when you are ready.";
  return `Approved${sample}.`;
}
