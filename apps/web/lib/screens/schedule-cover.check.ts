/** The schedule card opens a founder's video on the cover the edit set (plan 2026-11-15 A2). */

import assert from "node:assert/strict";

import { withCover } from "./schedule-enrich";

assert.equal(withCover(null, 2), null);
assert.equal(withCover("https://x.test/v.mp4?token=a", null), "https://x.test/v.mp4?token=a");
assert.equal(withCover("https://x.test/v.mp4?token=a", 2.5), "https://x.test/v.mp4?token=a#t=2.50");
assert.equal(withCover("https://x.test/v.mp4?token=a", 0), "https://x.test/v.mp4?token=a#t=0.00");
console.log("schedule cover: all checks pass");
