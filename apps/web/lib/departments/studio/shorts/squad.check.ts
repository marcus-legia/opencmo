/**
 * The Shorts squad's code (`squad.ts`): candidates are runs of whole sentences of 15–60 s, the Clip
 * reviewer catches every rule, and the fake Clip editor's picks pass it.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/departments/studio/shorts/squad.check.ts
 */
import assert from "node:assert/strict";

import { candidates, pickShorts, reviewShorts, sentences, shortCount, SHORT_SECONDS, type Word } from "./squad";

/** `count` sentences of `seconds` each, four words per sentence, back to back from 0. */
function talk(count: number, seconds = 6): Word[] {
  const words: Word[] = [];
  for (let index = 0; index < count; index++) {
    const start = index * seconds;
    const step = seconds / 4;
    ["Sentence", `number${index}`, "says", "something."].forEach((text, at) => words.push({ text, start: start + at * step, end: start + (at + 1) * step - 0.05 }));
  }
  return words;
}

const words = talk(15); // 90 s
assert.equal(sentences(words).length, 15);
assert.equal(sentences(words)[2]!.text, "Sentence number2 says something.");
assert.equal(sentences([{ text: "no", start: 0, end: 1 }, { text: "stop", start: 1, end: 2 }])[0]!.text, "no stop", "the last group ends the speech");
assert.equal(sentences([{ text: "bad.", start: 2, end: 1 }]).length, 0, "a word ending before it starts is dropped");

const list = candidates(words);
assert.ok(list.length > 0 && list.length <= 8);
for (const item of list) {
  assert.ok(item.end - item.start >= SHORT_SECONDS.min && item.end - item.start <= SHORT_SECONDS.max, "15–60 s");
  assert.ok(sentences(words).some((sentence) => sentence.start === item.start), "starts on a sentence");
  assert.ok(sentences(words).some((sentence) => sentence.end === item.end), "ends on a sentence");
}
assert.equal(shortCount(list), 3);
assert.equal(shortCount(candidates(talk(4))), 1, "24 s of speech holds one short");
assert.equal(candidates(talk(2)).length, 0, "12 s of speech holds none");

// Beats: runs on beat edges come first, so a short never cuts a shot.
const beats = [0, 18, 36, 54, 72].map((start) => ({ start, end: start + 18 }));
for (const item of candidates(words, beats)) {
  assert.ok(beats.some((beat) => Math.abs(beat.start - item.start) < 0.4), "starts on a beat");
}

// The reviewer.
const range = (first: number, last: number, hook = `Sentence number${first} says`) => ({
  start: first * 6,
  end: last * 6 + 6 - 0.05,
  hook,
  title: "A title",
  reason: "A reason.",
});
const good = [range(0, 3), range(5, 8), range(10, 13)];
assert.deepEqual(reviewShorts(good, words, 3), []);
assert.match(reviewShorts(good.slice(0, 2), words, 3).join(" "), /exactly 3/);
assert.match(reviewShorts([range(0, 3), { ...range(5, 8), start: 31 }, range(10, 13)], words, 3).join(" "), /start at the start of a sentence/);
assert.match(reviewShorts([range(0, 3), { ...range(5, 8), end: 50 }, range(10, 13)], words, 3).join(" "), /end at the end of a sentence/);
assert.match(reviewShorts([range(0, 10), range(11, 12), range(13, 14)], words, 3).join(" "), /66\.0s; a short lasts 15–60s/);
assert.match(reviewShorts([range(0, 3), range(2, 5), range(10, 13)], words, 3).join(" "), /Short 1 overlaps short 2/);
assert.match(reviewShorts([range(0, 3), range(5, 8, "Something else entirely"), range(10, 13)], words, 3).join(" "), /Short 2's hook/);

async function main() {
  // The fake Clip editor (as CI and the acceptance run use it): its picks pass the reviewer.
  process.env.OPENCMO_AGENT_FAKE = "1";
  const picked = await pickShorts({ words });
  assert.ok(Array.isArray(picked), String(picked));
  assert.equal(picked.length, 3);
  assert.deepEqual(reviewShorts(picked, words, 3), []);
  assert.deepEqual(picked.map((short) => short.start), [...picked.map((short) => short.start)].sort((a, b) => a - b), "sorted by start");
  assert.match(String(await pickShorts({ words: talk(2) })), /no stretch of 15–60 seconds/);

  console.log("shorts squad: candidates, reviewer and fake picks correct");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
