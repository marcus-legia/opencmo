/**
 * A script's markers (C1, 2026-11-09):
 *
 *     cd apps/web && npx tsx lib/cmo/script-markers.check.ts
 */
import assert from "node:assert/strict";

import { applyOps, readMarkers } from "@opencmo/editor-core";

import { scriptMarkers } from "./script-markers";

const beats = [
  { say: "Cut by words.", show: "You", shot: "talking_head" as const, seconds: 5 },
  { say: "Delete a word.", show: "Your editor", shot: "screen" as const, seconds: 15 },
  { say: "Try it.", show: "You", shot: "talking_head" as const, seconds: 10 },
];
const ops = scriptMarkers(beats);
assert.deepEqual(ops.map((op) => [op.time, op.duration, op.name]), [[0, 5, "01 · To camera"], [5, 15, "02 · Screen"], [20, 10, "03 · To camera"]], "one marker per beat, at its time");
assert.equal(ops[1]!.comment, "Say: Delete a word.\nShow: Your editor");
assert.equal(new Set(ops.map((op) => op.name)).size, ops.length, "names are unique, so a placed beat is recognised");

void (async () => {
  const doc = { version: 1, stage: { children: [{ kind: "scene", id: "sc", width: 1080, height: 1920, children: [] }] } };
  const { document } = await applyOps(doc as never, ops, {} as never);
  assert.equal(readMarkers(document).length, 3, "the ops apply to a blank edit");
  console.log("script-markers.check: ok");
})();
