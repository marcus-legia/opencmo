/**
 * Showing a quote. The model often copies a person's words with their quote marks, and the screen adds its own, so a
 * card read ““…”” (E2E 2026-11-22). `bare` drops the marks the text came with; the screen adds one pair.
 *
 * Only a person's own words are a quote: the pain and the evidence. Fit is Ferreto's judgement, timing and reach are
 * counted ("Posted 3 days ago", "25 comments"), so they show as plain text, not as something someone said.
 */
const MARKS = /^[\s"'“”‘’«»]+|[\s"'“”‘’«»]+$/g;

export function bare(text: string): string {
  const out = text.replace(MARKS, "");
  return out || text.trim();
}

const SAID = new Set(["pain", "evidence"]);

/** Whether a score part's text is the person's own words (shown in quote marks) rather than Ferreto's. */
export function isTheirWords(from: string): boolean {
  return SAID.has(from.trim().toLowerCase());
}
