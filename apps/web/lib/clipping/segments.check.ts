/**
 * Runs for real, not only at typecheck:
 *
 *     cd apps/web && npx tsx lib/clipping/segments.check.ts
 *
 * Contract A1: the picker URL and the moment rules. The MCP `make_clips` tool builds the URL, the
 * picker parses it and `createClipJob` judges the same moments, so a drift between them shows up as
 * a picker that opens with moments the server then refuses.
 */
import assert from "node:assert/strict";

import { clock, formatSegments, freeMoment, markedMoment, moveEdge, parseSegments, pickerPath, segmentProblem } from "./segments";

// Valid: unsorted input comes back sorted.
assert.deepEqual(parseSegments("90-120.5,10-40"), [
  { start: 10, end: 40 },
  { start: 90, end: 120.5 },
]);
assert.equal(segmentProblem([{ start: 10, end: 40 }]), null);
// Touching moments do not overlap.
assert.equal(segmentProblem([{ start: 0, end: 30 }, { start: 30, end: 60 }]), null);

// Overlapping.
assert.deepEqual(parseSegments("10-40,30-60"), []);
assert.match(segmentProblem([{ start: 10, end: 40 }, { start: 30, end: 60 }]) ?? "", /overlap/);

// Too long, too short.
assert.deepEqual(parseSegments("0-181"), []);
assert.match(segmentProblem([{ start: 0, end: 181 }]) ?? "", /3 minutes/);
assert.equal(segmentProblem([{ start: 0, end: 180 }]), null);
assert.match(segmentProblem([{ start: 5, end: 5.5 }]) ?? "", /at least 1 second/);
assert.match(segmentProblem([{ start: 40, end: 10 }]) ?? "", /at least 1 second/);

// More than 10.
const eleven = Array.from({ length: 11 }, (_, i) => `${i * 10}-${i * 10 + 5}`).join(",");
assert.deepEqual(parseSegments(eleven), []);
assert.equal(parseSegments(eleven.split(",").slice(0, 10).join(",")).length, 10);

// None at all.
assert.match(segmentProblem([]) ?? "", /at least one moment/);
assert.deepEqual(parseSegments(""), []);
assert.deepEqual(parseSegments(null), []);

// Garbage: one bad part empties the whole list.
for (const garbage of ["abc", "10-", "-10-20", "10-20,x", "1e3-1e3", "10:00-10:30", "10-20,,30-40", "NaN-Infinity"]) {
  assert.deepEqual(parseSegments(garbage), [], garbage);
}
assert.match(segmentProblem([{ start: Number.NaN, end: 10 }]) ?? "", /invalid/);
assert.match(segmentProblem([{ start: -5, end: 10 }]) ?? "", /invalid/);

// Round trip through the URL.
const moments = [
  { start: 75.25, end: 100 },
  { start: 12.3456, end: 42 },
];
assert.equal(formatSegments(moments), "12.346-42,75.25-100");
const path = pickerPath({ source: "https://www.youtube.com/watch?v=abc&t=3", segments: moments });
assert.ok(path.startsWith("/app/editor?panel=clips&picker=open&"), path);
const params = new URL(path, "https://opencmo.io").searchParams;
assert.equal(params.get("source"), "https://www.youtube.com/watch?v=abc&t=3");
assert.deepEqual(parseSegments(params.get("segments")), [
  { start: 12.346, end: 42 },
  { start: 75.25, end: 100 },
]);
assert.equal(pickerPath(), "/app/editor?panel=clips&picker=open");

console.log("segments.check: ok");

// ------------------------------------------------------------- editing helpers
{
  const two = [{ start: 10, end: 40 }, { start: 60, end: 90 }];

  // A new moment stops at the next one and at the end of the video.
  assert.deepEqual(freeMoment(two, 45, 300), { start: 45, end: 60 });
  assert.deepEqual(freeMoment(two, 100, 300), { start: 100, end: 130 });
  assert.deepEqual(freeMoment([], 290, 300), { start: 290, end: 300 });
  assert.equal(freeMoment(two, 20, 300), null, "inside a moment");
  assert.equal(freeMoment(two, 59.5, 300), null, "less than 1 s before the next");
  assert.equal(freeMoment(Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: i * 10 + 5 })), 200, 300), null, "10 already");
  assert.equal(freeMoment([], 0, 0), null, "duration unknown");

  // Dragging never breaks a rule.
  assert.deepEqual(moveEdge(two, 0, "end", 75, 300)[0], { start: 10, end: 60 }, "stops at the next moment");
  assert.deepEqual(moveEdge(two, 1, "start", 5, 300)[1], { start: 40, end: 90 }, "stops at the previous moment");
  assert.deepEqual(moveEdge(two, 0, "start", 39.8, 300)[0], { start: 39, end: 40 }, "keeps 1 s");
  assert.deepEqual(moveEdge([{ start: 0, end: 10 }], 0, "end", 500, 1000)[0], { start: 0, end: 180 }, "keeps 180 s");
  assert.deepEqual(moveEdge([{ start: 0, end: 10 }], 0, "end", 500, 50)[0], { start: 0, end: 50 }, "stays in the video");
  for (const list of [moveEdge(two, 0, "end", 1e9, 300), moveEdge(two, 1, "start", -1e9, 300)]) {
    assert.equal(segmentProblem(list), null);
  }

  // I then O, in either order.
  assert.deepEqual(markedMoment(two, 120, 100), { moment: { start: 100, end: 120 } });
  assert.match((markedMoment(two, 30, 50) as { problem: string }).problem, /overlap/);
  assert.match((markedMoment([], 0, 200) as { problem: string }).problem, /3 minutes/);

  assert.equal(clock(75.25), "1:15.3");
  assert.equal(clock(3725), "1:02:05.0");
  console.log("segments.check: editing helpers ok");
}
