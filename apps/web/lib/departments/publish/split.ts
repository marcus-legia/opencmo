/**
 * Splits a post that is longer than a platform takes into the parts of a chain (Threads, 500) or a thread (a free X
 * account, 280). Code does this, not the model: the founder approved these words, so every word goes out, in order,
 * and nothing is rewritten.
 *
 * Pure module: the publish adapter and the cards both use it, so the card shows the parts that will be posted.
 */

/** A post's length as Threads counts it here: code points, so an emoji is one character. */
export const postLength = (text: string): number => [...text].length;

type Measure = (text: string) => number;

/**
 * A link, or a bare domain ("opencmo.com", "app.io/pricing"), with the character before it kept in group 1 so an
 * e-mail's domain is not taken for a link. Closing punctuation after it (".", ")", ",") is not part of the link: X
 * ends the link there and counts those characters.
 */
const LINK = /(^|[^\w@.\/-])(https?:\/\/\S+?|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})(\/\S*?)?)(?=[)\].,!?;:'"”’]*(?:\s|$))/gi;
/**
 * Endings X links without "https://": the generic ones, and the country endings startups use as if they were. Another
 * two-letter ending ("README.md") is a link only with a path after it; "Next.js" never is.
 */
const BARE_LINK = new Set(["com", "net", "org", "info", "biz", "xyz", "app", "dev", "io", "ai", "co", "me", "so", "gg", "ly", "fm", "to", "tv", "sh"]);
const EMOJI = /\p{Extended_Pictographic}/u;
const X_URL = 23;

// Built once: the cutter measures every step. A browser without Intl.Segmenter cuts by code point instead.
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const graphemes = (text: string): string[] => (segmenter ? [...segmenter.segment(text)].map((g) => g.segment) : [...text]);

/**
 * X's weight of one code point: 1 in the ranges X counts light (Latin, Greek, Cyrillic, most punctuation), 2 for
 * everything else (CJK, "…", "→", "€", Vietnamese letters with tone marks). From twitter-text's v3 configuration
 * (github.com/twitter/twitter-text, config/v3.json, Apache-2.0: the numbers only, no code).
 */
function xWeight(codePoint: number): number {
  return codePoint <= 4351 || (codePoint >= 8192 && codePoint <= 8205) || (codePoint >= 8208 && codePoint <= 8223) ||
    (codePoint >= 8242 && codePoint <= 8247) ? 1 : 2;
}

function weigh(text: string): number {
  let n = 0;
  for (const g of graphemes(text)) {
    if (EMOJI.test(g)) n += 2;
    else for (const c of g) n += xWeight(c.codePointAt(0) ?? 0);
  }
  return n;
}

/**
 * A post's length as X counts it. Zernio's documents quote X's refusal (docs.zernio.com/platforms/twitter/reference,
 * read 2026-11-13): "URLs count as 23 characters and emojis as 2". A bare domain counts as at least 23: X links it
 * when it knows the ending, and counting more than X does only cuts a part earlier, never makes one X refuses.
 */
export function xLength(text: string): number {
  let n = 0;
  const rest = text.replace(LINK, (match: string, before: string, link: string, ending: string | undefined, path: string | undefined) => {
    if (/^https?:\/\//i.test(link)) n += X_URL;
    else if (BARE_LINK.has((ending ?? "").toLowerCase()) || (path && (ending ?? "").length === 2)) n += Math.max(X_URL, weigh(link));
    else return match;
    return before;
  });
  return n + weigh(rest);
}

/** Threads takes 500 characters a post; a free X account takes 280. */
export const THREADS_LIMIT = 500;
export const X_FREE_LIMIT = 280;
/** A thread longer than this is not offered: the founder shortens the post instead. */
export const MAX_THREAD_PARTS = 25;

const paragraphs = (text: string) => text.split(/\n\s*\n/);
/**
 * A sentence ends at . ! ? or … (and any closing quote or bracket after it) followed by a space or the end. A stop
 * inside a word is not an end: cut there, a link (example.com) or a number (3.5) would come out with a space in it.
 */
const sentences = (text: string) => text.replace(/([.!?…]+["'”’)\]]*)\s+/g, "$1\u0000").split("\u0000");
const words = (text: string) => text.split(/\s+/);

/**
 * A word longer than a post, cut into the longest pieces that fit; an emoji is never cut in half. Each piece is
 * measured whole, as the platform will: a link inside a long word counts 23 on X only once its piece holds "https://".
 */
function hardCut(word: string, limit: number, measure: Measure): string[] {
  const out: string[] = [];
  let current = "";
  for (const g of graphemes(word)) {
    if (current && measure(current + g) > limit) {
      out.push(current);
      current = "";
    }
    current += g;
  }
  if (current) out.push(current);
  return out;
}

/** Fills each part with as many whole units as fit; a unit that is too long on its own is broken down a level. */
function pack(units: string[], joiner: string, limit: number, measure: Measure, breakDown: (unit: string) => string[]): string[] {
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current) parts.push(current);
    current = "";
  };
  for (const raw of units) {
    const unit = raw.trim();
    if (!unit) continue;
    if (measure(unit) > limit) {
      flush();
      const smaller = breakDown(unit);
      // The tail of a broken unit may still take what follows it.
      current = smaller.pop() ?? "";
      parts.push(...smaller);
      continue;
    }
    const joined = current ? `${current}${joiner}${unit}` : unit;
    if (measure(joined) <= limit) current = joined;
    else {
      flush();
      current = unit;
    }
  }
  flush();
  return parts;
}

/** Parts of at most `limit` characters, cut at a paragraph, else a sentence, else a word. Never an empty part. */
export function splitPost(text: string, limit: number, measure: Measure = postLength): string[] {
  const whole = text.trim();
  if (!whole || limit < 1) return [];
  if (measure(whole) <= limit) return [whole];
  const byWord = (sentence: string) => pack(words(sentence), " ", limit, measure, (word) => hardCut(word, limit, measure));
  const bySentence = (paragraph: string) => pack(sentences(paragraph), " ", limit, measure, byWord);
  return pack(paragraphs(whole), "\n\n", limit, measure, bySentence);
}

/**
 * The parts a slot's text goes out in, or null when it goes out as one post: a Threads post over 500 characters is a
 * chain; an X post is a thread only when the founder asked for one (`as_thread`, after a free account refused it).
 */
export function chainFor(platform: string, text: string, asThread = false): string[] | null {
  if (platform === "threads" && postLength(text.trim()) > THREADS_LIMIT) return splitPost(text, THREADS_LIMIT);
  if (platform === "x" && asThread && xLength(text.trim()) > X_FREE_LIMIT) return splitPost(text, X_FREE_LIMIT, xLength);
  return null;
}

/** The words a refusal uses when the text is over what the account takes. */
const TOO_LONG = /too long|character limit|characters?\b.*\b(limit|max|exceed)|(limit|max|exceed)\w*\b.*\bcharacters?|\b280\b/i;

export const X_TOO_LONG = "Your X account takes 280 characters per post. Post it as a thread, or turn on X Premium.";
export const X_TOO_LONG_FOR_THREAD = "Your X account takes 280 characters per post, and this one is too long for a thread. Shorten it, or turn on X Premium.";

/** True when a platform's refusal is about the post's length. */
export const saysTooLong = (message: string): boolean => TOO_LONG.test(message);
