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
  );
  assert.deepEqual(clipTurn, { first: 7, last: 9 });
  assert.equal(writtenVersions([{ name: "get_tree", result: { summary: "read" } }]), undefined, "a turn that saved nothing");

  const written = { first: 7, last: 9 };
  assert.equal(await unchangedSince({ version: 9, document: doc("x") }, written, null), true, "still at the turn's version: restore");
  assert.equal(await unchangedSince({ version: 10, document: doc("x") }, written, null), false, "a manual save after the turn: refuse");
  assert.equal(await unchangedSince({ version: 40, document: doc("x") }, undefined, null), true, "a turn from before versions were stored: restore as before");

  // Library-only saves after the turn move the version but keep the document fingerprint.
  const hashed = writtenVersions(
    [
      { name: "edit", result: { summary: "a", version: 7, document_hash: "h7" } },
      { name: "edit", result: { summary: "b", version: 9, document_hash: "h9" } },
      { name: "edit", result: { summary: "c", version: 8, document_hash: "h8" } },
    ],
  );
  assert.deepEqual(hashed, { first: 7, last: 9, lastHash: "h9" }, "the hash belongs to the newest write, whatever the row order");
  assert.equal(await unchangedSince({ version: 12, document: doc("x"), document_hash: "h9" }, hashed, null), true, "library saves after the turn: restore");
  assert.equal(await unchangedSince({ version: 12, document: doc("y"), document_hash: "h12" }, hashed, null), false, "document edited after the turn: refuse");

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
