/**
 * find_retakes: earlier takes of a repeated sentence are suggested for removal, the last one stays.
 *
 *     tsx lib/agent/retakes.check.ts
 */
import assert from "node:assert/strict";

import type { Transcript, Word } from "@opencmo/editor-core";

import { findRetakes, similarity } from "./retakes";

/** One line per entry: [text, start seconds]; words get ids w<line>_<index>, 0.3 s each. */
function transcript(lines: Array<[string, number]>): Transcript {
  return lines.map(([text, start], line) => ({
    text,
    words: text.split(/\s+/).map((token, index) => ({ id: `w${line}_${index}`, text: token, start: start + index * 0.3, end: start + index * 0.3 + 0.25 })),
  }));
}
const none = (_: Word) => false;

// Three takes of one sentence, the first a false start: the last stays, both earlier go.
{
  const t = transcript([
    ["The thing about pricing is", 0],
    ["Um, the thing about pricing is that you charge too little.", 3],
    ["The thing about pricing is that most founders charge too little.", 8],
    ["Next, let us talk about sales.", 14],
  ]);
  const found = findRetakes(t, none);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]!.keep, ["w2_0", "w2_10"]);
  assert.deepEqual(found[0]!.drop, [
    ["w0_0", "w0_4"],
    ["w1_0", "w1_10"],
  ]);
  assert.equal(found[0]!.drop_word_ids.length, 5 + 11);
  assert.ok(found[0]!.drop_word_ids.includes("w1_0"));
  assert.match(found[0]!.text, /most founders/);
  assert.ok(found[0]!.similarity > 0.7);
}

// The same sentence two minutes apart is a deliberate repetition (a callback), not a retake.
{
  const t = transcript([
    ["Ship it before you feel ready.", 0],
    ["Here is a long story in between.", 10],
    ["Ship it before you feel ready.", 130],
  ]);
  assert.deepEqual(findRetakes(t, none), []);
}

// Unrelated sentences and short replies ("Yeah, right.") are never matched.
{
  const t = transcript([
    ["Yeah, right.", 0],
    ["Yeah, right.", 2],
    ["Our churn dropped after we fixed onboarding.", 4],
    ["The weather was nice that week.", 8],
  ]);
  assert.deepEqual(findRetakes(t, none), []);
}

// Two sentences on one caption line are split on the full stop, so only the repeated one is flagged.
{
  const t = transcript([
    ["I built this alone at night. I built this alone at night after work.", 0],
    ["Then it grew.", 6],
  ]);
  const found = findRetakes(t, none);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]!.drop, [["w0_0", "w0_5"]]);
  assert.deepEqual(found[0]!.keep, ["w0_6", "w0_13"]);
}

// Another language works on tokens (Vietnamese with diacritics and different punctuation).
{
  const t = transcript([
    ["Tôi làm việc ở khách sạn chín tiếng mỗi ngày", 0],
    ["Tôi làm việc ở khách sạn chín tiếng rưỡi mỗi ngày.", 5],
  ]);
  const found = findRetakes(t, none);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]!.keep, ["w1_0", "w1_10"]);
}

// One word changed in a retake ("a day" → "every day") is still the same sentence.
{
  const t = transcript([
    ["I wrote one helpful reply a day for a month", 0],
    ["I wrote one helpful reply every day for a month", 4],
  ]);
  assert.equal(findRetakes(t, none).length, 1);
}

// Words already cut are not compared: a take removed earlier no longer shows up.
{
  const t = transcript([
    ["We doubled revenue in one quarter.", 0],
    ["We doubled our revenue in one quarter.", 4],
  ]);
  assert.equal(findRetakes(t, none).length, 1);
  assert.deepEqual(findRetakes(t, (word) => word.id!.startsWith("w0_")), []);
}

// A longer first sentence followed by a short one with the same opening is a summary, not a false start.
assert.ok(similarity("the plan is to launch in may with three features".split(" "), "the plan is simple".split(" ")) < 0.7);

console.log("retakes: ok");
