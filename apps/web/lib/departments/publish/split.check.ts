/**
 * `splitPost`: every part fits, no part is empty, no word is cut unless it is longer than a post, and the words come
 * out in the order they went in.
 *
 *     cd apps/web && npx tsx lib/departments/publish/split.check.ts
 */
import assert from "node:assert/strict";

import { chainFor, postLength, splitPost, xLength } from "./split";

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

// X counts as Zernio's documents quote X's refusal (docs.zernio.com/platforms/twitter/reference, read 2026-11-13):
// "URLs count as 23 characters and emojis as 2".
assert.equal(xLength("hello"), 5);
assert.equal(xLength("🚀"), 2, "an emoji is 2 on X");
assert.equal(xLength("👩‍💻"), 2, "a joined emoji is one emoji");
assert.equal(xLength("see https://example.com/a/very/long/path/that/goes/on?and=on"), 4 + 23, "a link is 23");
assert.equal(xLength("é"), 1);
// A thread on X is cut by X's count: 200 rockets are 400 there, so two posts, each within 280.
const rockets = Array.from({ length: 200 }, () => "🚀").join(" ");
const xParts = chainFor("x", rockets, true) ?? [];
assert.ok(xParts.length >= 2, "emojis push an X post over 280");
for (const part of xParts) assert.ok(xLength(part) <= 280, `an X part counts ${xLength(part)}`);
assert.equal(xParts.join(" "), rockets, "every emoji goes out, in order");
const linky = Array.from({ length: 30 }, (_, i) => `https://example.com/${"x".repeat(40)}/${i}`).join(" ");
for (const part of chainFor("x", linky, true) ?? []) assert.ok(xLength(part) <= 280);
assert.equal((chainFor("x", linky, true) ?? []).length, 3, "30 links of 23 are three posts, not by their 60 letters");

// A stop inside a word is not a sentence end: a link or a number in a long post is posted whole.
const site = `${"We wrote it down. ".repeat(30)}Read it at https://example.com/notes.html today, it takes 3.5 minutes.`;
for (const parts of [splitPost(site, 500), chainFor("x", site, true) ?? []]) {
  assert.ok(parts.some((part) => part.includes("https://example.com/notes.html")), "the link is whole");
  assert.ok(parts.some((part) => part.includes("3.5 minutes")), "the number is whole");
}

console.log("split.check ok");
