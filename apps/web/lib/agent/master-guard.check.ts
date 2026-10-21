/**
 * The Assistant may not re-time the clip's own video through a timeline op: not the segments,
 * not their sound, not the cut sequence, and not a group around them.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/master-guard.check.ts
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { guard } from "./tools";

const cut = {
  kind: "sequence",
  id: "cut",
  marks: { "text-cut": { transcript: "t", window: { start: 0, end: 60 }, removed: [] } },
  children: [
    { kind: "video", id: "seg", src: "assets/master.mp4" },
    { kind: "audio", id: "sound", src: "assets/master.mp4" },
  ],
};
const document = {
  version: 1,
  stage: { children: [{ kind: "scene", id: "sc", children: [{ kind: "group", id: "g", children: [cut] }, { kind: "rect", id: "b", start: 10, end: 12 }] }] },
} as unknown as ClipDocument;

function main() {
  for (const id of ["seg", "sound", "cut", "g"]) {
    assert.match(guard({ op: "move_elements", element_ids: [id], by: 1 }, document) ?? "", /transcript/, `move ${id}`);
  }
  assert.match(guard({ op: "group_elements", element_ids: ["seg", "b"], into: "sequence", frame: 0 }, document) ?? "", /transcript/, "group with the master");
  assert.match(guard({ op: "move_layer", element_id: "b", parent_id: "cut" }, document) ?? "", /transcript/, "a clip into the cut sequence");
  assert.match(guard({ op: "move_layer", element_id: "seg", parent_id: "sc" }, document) ?? "", /transcript/, "a segment out of it");
  assert.equal(guard({ op: "move_elements", element_ids: ["b"], by: 1 }, document), null, "B-roll moves freely");
  assert.equal(guard({ op: "move_layer", element_id: "b", parent_id: "sc" }, document), null, "and changes layer freely");
  console.log("master-guard: ok");
}

main();
