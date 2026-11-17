/**
 * The owner's failures page (lib/ops/failures.ts). No database.
 *
 *   cd apps/web && npx tsx lib/ops/failures.check.ts
 */
import assert from "node:assert/strict";

import { ago, displayKey, failureWindow, sourceLabel, warningLabel } from "./failures";

assert.equal(failureWindow("30"), 30);
assert.equal(failureWindow("90"), 90);
assert.equal(failureWindow(undefined), 7, "no window: the last week");
assert.equal(failureWindow("365"), 7, "a window the page does not offer: the last week");
assert.equal(failureWindow("7abc"), 7);

assert.equal(displayKey("Probe of <id> failed after <n> s."), "Probe of … failed after N s.");
assert.equal(displayKey("No placeholder"), "No placeholder");

assert.equal(sourceLabel("schedule_slots"), "Publish");
assert.equal(sourceLabel("something_new"), "something_new", "a source the page does not know yet still shows");

assert.equal(ago("2026-11-17T09:00:00Z", new Date("2026-11-17T12:30:00Z")), "3.5 h ago");
assert.equal(ago("2026-11-17T12:30:05Z", new Date("2026-11-17T12:30:00Z")), "0 s ago", "a clock a little ahead of the database is not negative");
assert.equal(ago("2026-11-14T12:30:00Z", new Date("2026-11-17T12:30:00Z")), "3.0 days ago");

assert.match(warningLabel("transcript_failed"), /without a transcript/);
assert.match(warningLabel("framing_centre_no_detector"), /no face detector/);
assert.match(warningLabel("framing_centre_no_frames"), /Framed in the centre/);
assert.match(warningLabel("framing_centre_tracking_failed"), /Framed in the centre/);
assert.equal(warningLabel("a_new_code"), "a_new_code", "a code the page does not know yet still shows");

console.log("failures.check: ok");

// The hourly alert reads the same grouping; its check runs here so `check:contracts` covers it.
void import("./failure-alerts.check");
