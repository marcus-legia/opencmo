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

  // 2. A blank New edit gets no tool that needs the clip's own video; a speaker clip gets them all.
  {
    const { clipToolSpecs } = await import("./scope");
    const { OWN_VIDEO_TOOLS, NOT_OFFERED, TOOL_SPECS } = await import("./tools");
    const blank = clipToolSpecs({ blank: true }).map((spec) => spec.name);
    const own = clipToolSpecs().map((spec) => spec.name);
    for (const name of OWN_VIDEO_TOOLS) {
      assert.ok(own.includes(name), `${name} is offered on a speaker clip`);
      assert.ok(!blank.includes(name), `${name} is not offered on a blank edit`);
    }
    assert.deepEqual(own.filter((name) => !blank.includes(name)).sort(), [...OWN_VIDEO_TOOLS].sort(), "nothing else differs");
    // Near-twins are not offered; the ones that replace them are.
    for (const name of NOT_OFFERED) assert.ok(!own.includes(name), `${name} is not offered`);
    for (const name of ["set_props", "duplicate_elements", "set_keyframe"]) assert.ok(own.includes(name));
    assert.ok(TOOL_SPECS.every((spec) => spec.description.length > 20), "every tool says what it does");
  }

  // 3. set_props keeps update_element's rules: no captions source, no frame size by props.
  {
    const { runTool } = await import("./tools");
    const { memoryWorkspace } = await import("./workspace");
    const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, TRANSCRIPT } = await import("./eval/fixture");
    const workspace = memoryWorkspace(
      { version: 1, document: fixtureDocument(), manifest: fixtureManifest() },
      { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": TRANSCRIPT }, master: FIXTURE_MASTER },
    );
    const captions = JSON.stringify((await workspace.read()).document).match(/"kind":"captions","id":"([^"]+)"/)?.[1];
    assert.ok(captions, "the fixture has captions");
    const refused = await runTool("set_props", { element_id: captions, props: { src: "assets/other.json" } }, { workspace });
    assert.equal(refused.ok, false);
    assert.match(refused.content, /from the transcript/);
    const allowed = await runTool("set_props", { element_id: captions, props: { offsetY: -120 } }, { workspace });
    assert.equal(allowed.ok, true, allowed.content);
  }

  console.log("agent-design.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
