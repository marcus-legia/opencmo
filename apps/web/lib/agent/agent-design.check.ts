/**
 * How the Assistant is put together, offline: which tool calls may run at the same time, which
 * tools each kind of clip gets, and what the system prompt promises.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/agent-design.check.ts
 */
import assert from "node:assert/strict";

import { PARALLEL_SAFE, readGroup } from "./tools";

async function main(): Promise<void> {
  // 1. Reads next to each other run together; a write ends the group, so a later read sees it.
  {
    const calls = ["get_project_state", "get_transcript", "list_library", "set_frame", "check", "capture"].map((name) => ({ name }));
    assert.deepEqual(readGroup(calls, 0).map((call) => call.name), ["get_project_state", "get_transcript", "list_library"]);
    assert.deepEqual(readGroup(calls, 3), [], "a write runs alone");
    assert.deepEqual(readGroup(calls, 4).map((call) => call.name), ["check"], "browser tools wait for the tab");
    for (const name of ["capture", "ask_user", "update_plan", "generate_media", "insert_asset", "save_skill", "request_export"]) {
      assert.ok(!PARALLEL_SAFE.has(name), `${name} writes, pauses or spends`);
    }
  }

  console.log("agent-design.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
