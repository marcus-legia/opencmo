/**
 * `splitPost`: every part fits, no part is empty, no word is cut unless it is longer than a post, and the words come
 * out in the order they went in.
 *
 *     cd apps/web && npx tsx lib/departments/publish/split.check.ts
 */
import assert from "node:assert/strict";

import { chainFor, postLength, splitPost } from "./split";

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function sound(text: string, limit: number, parts: string[]) {
  for (const part of parts) {
    assert.ok(postLength(part) <= limit, `a part has ${postLength(part)} characters, over ${limit}`);
    assert.ok(part.trim().length > 0, "a part is empty");
    assert.equal(part, part.trim(), "a part starts or ends with white space");
  }
  assert.equal(squash(parts.join(" ")), squash(text), "words were lost or moved");
}

// Exactly the limit: one post. One over: two.
const exact = `${"word ".repeat(99)}word.`;
assert.equal(postLength(exact), 500);
assert.deepEqual(splitPost(exact, 500), [exact]);
const over = `${exact} x`;
assert.equal(splitPost(over, 500).length, 2);
sound(over, 500, splitPost(over, 500));
assert.equal(splitPost(`${"a".repeat(500)}b`, 500).length, 2, "501 characters are two parts");

// Paragraphs stay whole when they fit.
const para = (n: number) => `Paragraph ${n} says one thing. ${"It adds a detail. ".repeat(12)}`.trim();
const three = [para(1), para(2), para(3)].join("\n\n");
const byParagraph = splitPost(three, 500);
sound(three, 500, byParagraph);
assert.deepEqual(byParagraph, [`${para(1)}\n\n${para(2)}`, para(3)], "two paragraphs that fit share a part");

// A paragraph over the limit is cut at a sentence.
const long = `${"This sentence is here to fill the paragraph up. ".repeat(14)}`.trim();
const bySentence = splitPost(long, 500);
sound(long, 500, bySentence);
assert.ok(bySentence.every((p) => /[.]$/.test(p)), "each part ends at a sentence");

// One sentence of 700 characters: cut at words, none cut in half.
const sentence = `${"alpha beta gamma ".repeat(41)}end.`;
assert.ok(postLength(sentence) >= 700);
const byWord = splitPost(sentence, 500);
sound(sentence, 500, byWord);
assert.ok(byWord.every((p) => p.split(" ").every((w) => ["alpha", "beta", "gamma", "end."].includes(w))), "a word was cut in half");

// One word over the limit is the only thing cut inside a word.
const word = "x".repeat(1100);
assert.deepEqual(splitPost(word, 500).map(postLength), [500, 500, 100]);

// An emoji is one character; none is cut in half.
const emoji = "🚀".repeat(501);
assert.deepEqual(splitPost(emoji, 500).map(postLength), [500, 1]);
const emojiWords = Array.from({ length: 300 }, () => "🎉🎉").join(" ");
sound(emojiWords, 500, splitPost(emojiWords, 500));
assert.equal(splitPost("🚀".repeat(500), 500).length, 1);

// Nothing to post is no parts, never an empty one.
assert.deepEqual(splitPost("   \n\n  ", 500), []);
sound("a\n\n\n\n\nb", 500, splitPost("a\n\n\n\n\nb", 500));

// A chain only where the platform needs one.
assert.equal(chainFor("threads", exact), null);
assert.equal(chainFor("threads", over)?.length, 2);
assert.equal(chainFor("x", over), null, "X takes a long post as one");
assert.ok((chainFor("x", over, true)?.length ?? 0) >= 2, "a thread on X only when the founder asked");
assert.equal(chainFor("x", "short", true), null);
assert.equal(chainFor("linkedin", over, true), null);

console.log("split.check ok");
