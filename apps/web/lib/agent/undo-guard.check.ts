/**
 * The Assistant's turn Undo refuses once the clip was edited after the turn.
 *
 *     tsx lib/agent/undo-guard.check.ts
 */
import assert from "node:assert/strict";

import { unchangedSince, writtenVersions } from "./undo-guard";

const doc = (label: string) => ({ version: 1, stage: { label } });

async function main() {
  // Versions from a clip chat: every finished call that saved; calls without one are ignored.
  const clipTurn = writtenVersions(
    [
      { name: "edit", result: { summary: "a", version: 7 } },
      { name: "get_tree", result: { summary: "read" } },
      { name: "generate_media", result: { summary: "b", version: 9 } },
    ],
    "clip-1",
  );
  assert.deepEqual(clipTurn.get("clip-1"), { first: 7, last: 9 });

  // Versions from a project chat: per clip, from apply_to_clips only.
  const projectTurn = writtenVersions(
    [
      { name: "apply_to_clips", result: { clips: [{ clip_id: "a", version: 3 }, { clip_id: "b", version: 12 }] } },
      { name: "apply_to_clips", result: { clips: [{ clip_id: "a", version: 4 }] } },
      { name: "list_clips", result: { version: 99 } },
    ],
    null,
  );
  assert.deepEqual(projectTurn.get("a"), { first: 3, last: 4 });
  assert.deepEqual(projectTurn.get("b"), { first: 12, last: 12 });

  const written = { first: 7, last: 9 };
  assert.equal(await unchangedSince({ version: 9, document: doc("x") }, written, null), true, "still at the turn's version: restore");
  assert.equal(await unchangedSince({ version: 10, document: doc("x") }, written, null), false, "a manual save after the turn: refuse");
  assert.equal(await unchangedSince({ version: 40, document: doc("x") }, undefined, null), true, "a turn from before versions were stored: restore as before");

  // A newer turn was undone first: the clip holds that turn's checkpoint.
  const checkpoint = async () => doc("after turn");
  assert.equal(
    await unchangedSince({ version: 13, document: doc("after turn") }, written, { written: { first: 10, last: 11 }, checkpoint }),
    true,
    "newer turn followed directly and its undo is all that happened since: restore",
  );
  assert.equal(
    await unchangedSince({ version: 13, document: doc("after turn") }, written, { written: { first: 11, last: 12 }, checkpoint }),
    false,
    "a manual save between this turn and the newer one: refuse",
  );
  assert.equal(
    await unchangedSince({ version: 14, document: doc("edited after the undo") }, written, { written: { first: 10, last: 11 }, checkpoint }),
    false,
    "an edit after undoing the newer turn: refuse",
  );

  console.log("undo-guard ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
