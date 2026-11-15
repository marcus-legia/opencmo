/** The recorder's pure logic: container choice, the take's clock, script pacing, names and keys. */

import assert from "node:assert/strict";

import { beatAt, clockLabel, extensionOf, pickMime, sliceKey, TakeClock, takeName } from "./recorder";

// Safari records MP4 only; Firefox WebM only; a browser that throws on a codec string falls through to the next.
assert.equal(pickMime((mime) => mime === "video/mp4"), "video/mp4");
assert.equal(pickMime((mime) => mime.startsWith("video/webm;codecs=vp8")), "video/webm;codecs=vp8,opus");
assert.equal(
  pickMime((mime) => {
    if (mime.includes("avc1")) throw new Error("bad codec string");
    return mime === "video/webm";
  }),
  "video/webm",
);
assert.equal(pickMime(() => false), null);
assert.equal(pickMime((mime) => mime === "audio/webm", "audio"), "audio/webm");

assert.equal(extensionOf("video/mp4;codecs=avc1.42E01F,mp4a.40.2"), "mp4");
assert.equal(extensionOf("video/webm;codecs=vp9,opus"), "webm");
assert.equal(extensionOf("audio/mp4"), "m4a");
assert.equal(extensionOf("audio/webm;codecs=opus"), "weba");

assert.equal(takeName(new Date(2026, 10, 5, 9, 7), "video/webm"), "Recording 2026-11-05 09-07.webm");

// Pauses do not count; a second pause or a resume without a pause changes nothing.
const clock = new TakeClock();
assert.equal(clock.seconds(0), 0);
clock.start(1000);
clock.pause(4000);
clock.pause(5000);
assert.equal(clock.seconds(9000), 3);
clock.resume(10_000);
clock.resume(11_000);
assert.equal(clock.seconds(12_000), 5);
clock.stop(13_000);
assert.equal(clock.seconds(99_000), 6);
// Stopping while paused ends the take at the pause.
const paused = new TakeClock();
paused.start(0);
paused.pause(2000);
paused.stop(8000);
assert.equal(paused.seconds(20_000), 2);

assert.equal(clockLabel(0), "00:00");
assert.equal(clockLabel(125.9), "02:05");

// Beats paced by their own seconds; past the end, the last beat stays.
const beats = [{ seconds: 3 }, { seconds: 5 }, { seconds: 4 }];
assert.equal(beatAt(beats, 0), 0);
assert.equal(beatAt(beats, 2.99), 0);
assert.equal(beatAt(beats, 3), 1);
assert.equal(beatAt(beats, 11.9), 2);
assert.equal(beatAt(beats, 60), 2);
assert.equal(beatAt([], 5), 0);

// Slice keys sort in slice order as strings.
assert.ok(sliceKey("t", 9) < sliceKey("t", 10));

console.log("recorder: all checks pass");
