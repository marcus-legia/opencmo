/**
 * Decisions on approval cards, through `POST /api/v1/approvals/[id]` (`approval_decide`). The card's
 * `contentHash` goes back with every decision, so a screen that shows an older version is refused instead of
 * approving text the founder never saw. Fixture cards (outside production only) never reach the network.
 */

import { ApiError, api, jsonBody } from "@/components/clipping/api";
import { CAPTION_ACTION, DECIDABLE_IN_WAVE_1, type ApprovalCard, type Caption } from "@/lib/screens/approval-card";
import type { Platform } from "@/lib/screens/common";

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
  /** Script and price cards: stop the video here; nothing more is spent (keyframes already made stay paid for). */
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

/** The card with one caption's words replaced, as the server answers it but with the old hash (sample cards only). */
function withCaption(card: ApprovalCard, caption: Caption): ApprovalCard {
  const swap = (list: Caption[]) => list.map((c) => (c.id === caption.id ? caption : c));
  if (card.body.kind === "finished_video") return { ...card, body: { ...card.body, captions: swap(card.body.captions) } };
  if (card.body.kind === "shorts_batch") return { ...card, body: { ...card.body, shorts: card.body.shorts.map((s) => ({ ...s, captions: swap(s.captions) })) } };
  return card;
}

/**
 * Changes one caption on a finished video or shorts card before it is approved. Not a decision: the card stays
 * waiting, with a new `contentHash` the next decision must send. Sample cards change on this screen only.
 */
export async function editCaption(card: ApprovalCard, caption: Caption, sample: boolean): Promise<ApprovalCard> {
  if (sample) return withCaption(card, caption);
  const reason = blockedReason(card, sample);
  if (reason) throw new ApiError(reason, 0, null);
  const next = await api<ApprovalCard>(
    `/approvals/${encodeURIComponent(card.id)}`,
    jsonBody({ action: CAPTION_ACTION, contentHash: card.contentHash, caption: caption.id, text: caption.text, ...(caption.title !== null ? { title: caption.title } : {}) }),
  );
  // The answer is not signed: keep this card's previews and take the new hash and the captions as saved.
  const saved = (next.body.kind === "finished_video" ? next.body.captions : next.body.kind === "shorts_batch" ? next.body.shorts.flatMap((s) => s.captions) : []).find(
    (c) => c.id === caption.id,
  );
  return { ...withCaption(card, saved ?? caption), contentHash: next.contentHash };
}

/**
 * Where an approved post goes until Schedule posts it (P4): Threads opens its composer with the text in it;
 * LinkedIn's composer takes no text, so the post is copied first. X keeps "post it when you are ready".
 */
export const POST_TARGET: Partial<Record<Platform, { url: (text: string) => string; copy: boolean; label: string }>> = {
  threads: { url: (text) => `https://www.threads.com/intent/post?text=${encodeURIComponent(text)}`, copy: false, label: " and open Threads" },
  linkedin: { url: () => "https://www.linkedin.com/feed/?shareActive=true", copy: true, label: ", copy and open LinkedIn" },
};

/** The platform of a post card (one platform per card since P3). */
export function postPlatform(card: ApprovalCard): Platform | null {
  return card.body.kind === "post" ? (card.body.platforms[0]?.platform ?? null) : null;
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
      return card.kind === "correction" ? `Dismissed. Drafts stay as they are${suffix}.` : `Rejected${suffix}.`;
    case "redo":
      return `Making keyframe ${decision.index + 1} again. A new card comes when it is ready${suffix}.`;
    case "cancel":
      // Card 2 comes after the keyframes were made and paid for: only card 1 is cancelled before any spend.
      return card.kind === "price" ? `Cancelled. Nothing more will be spent${suffix}.` : `Cancelled. No credits were spent${suffix}.`;
    case "send_back":
      return card.kind === "finished_video" ? `Sent back. The edit stays open in the editor${suffix}.` : `Sent back with your note${suffix}.`;
    case "edit":
      if (card.kind === "correction") return `Kept your version of the rule. Every draft follows it${suffix}.`;
      if (card.kind === "script") return `Beat changed. The script is planned again and comes back as a new card${suffix}.`;
      return `Approved${suffix}.`;
    default:
      if (card.kind === "post" && !sample) {
        const platform = postPlatform(card);
        if (platform === "threads") return "Approved. Threads opened with your post: check it and post it from your account.";
        if (platform === "linkedin") return "Approved and copied. Paste it in LinkedIn and post it from your account.";
        return "Approved. Post it on X when you are ready.";
      }
      if (card.kind === "script") return `Script approved. The keyframes are being made${suffix}.`;
      if (card.kind === "price") return `Price approved. The video is being made${suffix}.`;
      if (card.kind === "finished_video") return `Marked finished. Shorts can be cut from it${suffix}.`;
      if (card.kind === "correction") return `Kept as a rule. Every draft follows it${suffix}.`;
      if (card.body.kind === "shorts_batch") return `Approved ${card.body.shorts.length} shorts. They are ready to schedule${suffix}.`;
      return `Approved${suffix}.`;
  }
}
