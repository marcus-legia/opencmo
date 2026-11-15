/**
 * Timeline math (plan 2026-11-15, session B): snap, zoom limits and anchor. Run with
 * `tsx components/editor/timeline/timeline.check.ts`.
 */

import assert from "node:assert/strict";

import { snapDelta, snapFrame } from "./snap";
import { clampZoom, zoomAnchor, zoomFloor, ZOOM_MAX } from "./zoom";

// Snap: the nearest target wins, except the playhead, which wins whenever it is in range.
assert.equal(snapFrame(100, [98, 103], 4), 98);
assert.equal(snapFrame(100, [99], 4, 103), 103);
assert.equal(snapFrame(100, [99], 4, 110), 99);
assert.equal(snapFrame(100, [90], 4), null);
// Two edges: the end edge (150 → 152) is nearer the target 152 than the start edge is to anything.
assert.deepEqual(snapDelta([100, 150], 0, [96, 152], 5), { delta: 2, at: 152 });
// The playhead beats a nearer target.
assert.deepEqual(snapDelta([100, 150], 0, [101], 5, 104), { delta: 4, at: 104 });
assert.deepEqual(snapDelta([100, 150], 0, [101], 5, 120), { delta: 1, at: 101 });
assert.equal(snapDelta([100], 0, [], 0, 100)?.at, 100);

// Zoom floor: a 30-minute scene (54,000 frames) fits a quarter of a 1,200 px lane.
const thirty = zoomFloor(54_000, 1_200);
assert.ok(Math.abs(thirty * 54_000 - 300) < 1e-6);
// A short lane still gives the scene 200 px; a 2 s clip is capped so it can zoom out a little.
assert.ok(Math.abs(zoomFloor(54_000, 400) * 54_000 - 200) < 1e-6);
assert.equal(zoomFloor(60, 1_200), 0.1);
assert.equal(zoomFloor(0, 1_200), 0.1);
// Fit of 30 minutes in 1,200 px (~0.022 px/frame) is no longer below the floor.
assert.equal(clampZoom(1_200 / 54_000, thirty), 1_200 / 54_000);
assert.equal(clampZoom(500, thirty), ZOOM_MAX);

// Anchor: the playhead when it is on screen, else the centre.
assert.equal(zoomAnchor(500, 200, 800), 300);
assert.equal(zoomAnchor(1_500, 200, 800), 400);
assert.equal(zoomAnchor(100, 200, 800), 400);

console.log("timeline.check: ok");
