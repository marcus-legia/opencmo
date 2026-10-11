/**
 * /video moderation before the card: each shot, the script and the music are checked on their own,
 * so a block names the piece to rewrite, and a long video is not cut at moderation's character
 * limit. `createGeneration` checks each piece again when it runs.
 */

import type { GenerationSpec } from "@opencmo/editor-core/generate";

import { ApiError } from "@/lib/api/errors";
import { moderateText, specText } from "@/lib/generate/moderation";

/** `kind` is the model kind the piece goes to: a voice script is judged as audio. */
export type Piece = { label: string; spec: GenerationSpec; kind?: string };

/** null when every piece passes; otherwise the tool result for the model and a short summary. */
export async function screenPieces(pieces: Piece[]): Promise<{ content: string; summary: string } | null> {
  const results = await Promise.allSettled(pieces.map((piece) => moderateText(specText(piece.spec).join("\n"), { kind: piece.kind })));
  const blocked = pieces.filter((_piece, index) => {
    const result = results[index]!;
    return result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 422;
  });
  if (blocked.length) {
    const message = `Against the content policy: ${blocked.map((piece) => piece.label).join("; ")}. Rewrite ${blocked.length === 1 ? "it" : "them"} without that content and call create_video again.`;
    return { content: JSON.stringify({ INVALID_INPUT: message }), summary: `${blocked.length} ${blocked.length === 1 ? "piece" : "pieces"} blocked` };
  }
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) {
    const message = failed.reason instanceof ApiError ? failed.reason.message : "Could not check this request. Please try again.";
    return { content: JSON.stringify({ INVALID_INPUT: message }), summary: message };
  }
  return null;
}
