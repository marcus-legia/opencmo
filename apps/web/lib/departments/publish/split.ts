/**
 * Splits a post that is longer than a platform takes into the parts of a chain (Threads, 500) or a thread (a free X
 * account, 280). Code does this, not the model: the founder approved these words, so every word goes out, in order,
 * and nothing is rewritten.
 *
 * Pure module: the publish adapter and the cards both use it, so the card shows the parts that will be posted.
 */

/** A post's length as the platforms count it here: code points, so an emoji is one character. */
export const postLength = (text: string): number => [...text].length;

/** Threads takes 500 characters a post; a free X account takes 280. */
export const THREADS_LIMIT = 500;
export const X_FREE_LIMIT = 280;
/** A thread longer than this is not offered: the founder shortens the post instead. */
export const MAX_THREAD_PARTS = 25;

const paragraphs = (text: string) => text.split(/\n\s*\n/);
/** A sentence ends at . ! ? or … (and any closing quote or bracket after it). */
const sentences = (text: string) => text.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) ?? [text];
const words = (text: string) => text.split(/\s+/);

function hardCut(word: string, limit: number): string[] {
  const chars = [...word];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += limit) out.push(chars.slice(i, i + limit).join(""));
  return out;
}

/** Fills each part with as many whole units as fit; a unit that is too long on its own is broken down a level. */
function pack(units: string[], joiner: string, limit: number, breakDown: (unit: string) => string[]): string[] {
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current) parts.push(current);
    current = "";
  };
  for (const raw of units) {
    const unit = raw.trim();
    if (!unit) continue;
    if (postLength(unit) > limit) {
      flush();
      const smaller = breakDown(unit);
      // The tail of a broken unit may still take what follows it.
      current = smaller.pop() ?? "";
      parts.push(...smaller);
      continue;
    }
    const joined = current ? `${current}${joiner}${unit}` : unit;
    if (postLength(joined) <= limit) current = joined;
    else {
      flush();
      current = unit;
    }
  }
  flush();
  return parts;
}

/** Parts of at most `limit` characters, cut at a paragraph, else a sentence, else a word. Never an empty part. */
export function splitPost(text: string, limit: number): string[] {
  const whole = text.trim();
  if (!whole || limit < 1) return [];
  if (postLength(whole) <= limit) return [whole];
  const byWord = (sentence: string) => pack(words(sentence), " ", limit, (word) => hardCut(word, limit));
  const bySentence = (paragraph: string) => pack(sentences(paragraph), " ", limit, byWord);
  return pack(paragraphs(whole), "\n\n", limit, bySentence);
}

/**
 * The parts a slot's text goes out in, or null when it goes out as one post: a Threads post over 500 characters is a
 * chain; an X post is a thread only when the founder asked for one (`as_thread`, after a free account refused it).
 */
export function chainFor(platform: string, text: string, asThread = false): string[] | null {
  if (platform === "threads" && postLength(text.trim()) > THREADS_LIMIT) return splitPost(text, THREADS_LIMIT);
  if (platform === "x" && asThread && postLength(text.trim()) > X_FREE_LIMIT) return splitPost(text, X_FREE_LIMIT);
  return null;
}

/** The words a refusal uses when the text is over what the account takes. */
const TOO_LONG = /too long|character limit|characters?\b.*\b(limit|max|exceed)|(limit|max|exceed)\w*\b.*\bcharacters?|\b280\b/i;

export const X_TOO_LONG = "Your X account takes 280 characters per post. Post it as a thread, or turn on X Premium.";
export const X_TOO_LONG_FOR_THREAD = "Your X account takes 280 characters per post, and this one is too long for a thread. Shorten it, or turn on X Premium.";

/** True when a platform's refusal is about the post's length. */
export const saysTooLong = (message: string): boolean => TOO_LONG.test(message);
