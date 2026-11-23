/**
 * A reply idea, read for the screen (owner, 2026-11-23): the point to make ("Idea"), the step that solves it
 * ("Solution"), and under each the words the founder could say. Sales writes it as plain lines:
 *
 *   Idea: Free users rarely become customers. Ask who pays first.
 *   "My first ten came from asking who pays for a tool like this today."
 *   Solution: Find people already asking for it and answer them one by one.
 *   "Search your niche for the exact complaint and reply there."
 *
 * An idea written before this shape (no labels) still shows: its first line is the idea, the rest are words to say.
 */
export type IdeaPart = { kind: "idea" | "solution"; text: string; say: string[] };

const LABEL = /^\s*(?:[-*•]\s*)?\**\s*(idea|solution)\s*\**\s*[:：]\s*\**\s*/i;
const MARKS = /^[\s"“”'‘’]+|[\s"“”'‘’]+$/g;

export function parseIdea(draft: string): IdeaPart[] {
  const lines = draft.split("\n").map((line) => line.trim()).filter(Boolean);
  const parts: IdeaPart[] = [];
  for (const line of lines) {
    const label = line.match(LABEL);
    if (label) {
      parts.push({ kind: label[1]!.toLowerCase() as IdeaPart["kind"], text: line.slice(label[0].length).replace(/\*+$/, "").trim(), say: [] });
      continue;
    }
    const last = parts[parts.length - 1];
    if (!last) {
      // An unlabelled idea: its first line is the point.
      parts.push({ kind: "idea", text: line.replace(MARKS, ""), say: [] });
      continue;
    }
    const said = line.replace(MARKS, "");
    if (said) last.say.push(said);
  }
  // A reply with only an idea still carries the word "Solution" (owner: both keywords always show), empty.
  if (parts.length && !parts.some((p) => p.kind === "solution")) parts.push({ kind: "solution", text: "", say: [] });
  return parts;
}

const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * How much of the founder's reply is their own words, 0 to 100: the share of its words that are not in the idea. A
 * reply shorter than 12 words counts as if it had 12, so two new words are not "mostly yours".
 */
export function ownShare(reply: string, idea: string): number {
  const said = new Set(words(idea));
  const mine = words(reply);
  if (!mine.length) return 0;
  const own = mine.filter((w) => !said.has(w)).length;
  return Math.min(100, Math.round((own / Math.max(mine.length, 12)) * 100));
}

/** The share at which a reply counts as the founder's own and Copy and open turns on. */
export const OWN_ENOUGH = 50;
