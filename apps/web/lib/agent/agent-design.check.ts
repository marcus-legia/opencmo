/**
 * How the Assistant is put together, offline: which tool calls may run at the same time, which
 * tools each kind of clip gets, and what the system prompt promises.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/agent-design.check.ts
 */
import assert from "node:assert/strict";

import { PARALLEL_SAFE, readGroup } from "./tools";

async function main(): Promise<void> {
  // The fake media catalog, so the priced tools (create_video, generate_media…) are offered here too.
  process.env.OPENCMO_AI_FAKE = "1";
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

  // 4. wait_for_media: one call waits for the clip's generations instead of polling list_library.
  {
    const { runWaitForMedia, waitReport } = await import("./wait-tool");
    const shot = (status: string, error: string | null = null) => ({ kind: "video", status, error, spec: { prompt: "A laptop on a desk at golden hour" }, created_at: "2026-10-13T05:00:00Z" });
    let reads = 0;
    let clock = 0;
    const rows = [[shot("running"), shot("queued")], [shot("done"), shot("running")], [shot("done"), shot("failed", "The model refused the prompt.")]];
    const query = {
      select: () => query,
      eq: (column: string, value: string) => (assert.deepEqual([column, value], ["clip_id", "clip-1"]), query),
      gte: () => query,
      order: async () => ({ data: rows[Math.min(reads++, rows.length - 1)], error: null }),
    };
    const supabase = { from: (table: string) => (assert.equal(table, "generations"), query) } as never;
    const waited = await runWaitForMedia({}, { supabase, clipId: "clip-1", now: () => clock, sleep: async (ms) => void (clock += ms) });
    assert.equal(reads, 3, "it polls until nothing is running");
    const report = JSON.parse(waited.content);
    assert.equal(report.done, 1);
    assert.deepEqual(report.failed, [{ piece: "video: A laptop on a desk at golden hour", reason: "The model refused the prompt." }]);
    assert.match(report.next, /refunded/);
    // It gives up after `seconds` and says what is still running.
    reads = 0;
    clock = 0;
    rows.splice(0, rows.length, [shot("running")]);
    const late = JSON.parse((await runWaitForMedia({ seconds: 10 }, { supabase, clipId: "clip-1", now: () => clock, sleep: async (ms) => void (clock += ms) })).content);
    assert.deepEqual(late.still_generating, ["video: A laptop on a desk at golden hour"]);
    assert.ok(clock <= 10_000, "never waits past its limit");
    assert.match(waitReport([]).content, /Nothing is generating/);
  }

  // 5. place_broll: several library shots in one write, each at its words, muted, fading.
  {
    const { runTool } = await import("./tools");
    const { memoryWorkspace } = await import("./workspace");
    const { checkDocument } = await import("@opencmo/editor-core");
    const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, TRANSCRIPT } = await import("./eval/fixture");
    const workspace = memoryWorkspace(
      { version: 1, document: fixtureDocument(), manifest: fixtureManifest() },
      { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": TRANSCRIPT }, master: FIXTURE_MASTER },
    );
    const before = (await workspace.read()).version;
    const placed = await runTool(
      "place_broll",
      { beats: [{ path: "assets/broll.mp4", quote: "better hooks" }, { path: "assets/broll.mp4", start: 1, seconds: 2, fit: "pip", source_start: 1 }] },
      { workspace },
    );
    assert.equal(placed.ok, true, placed.content);
    const after = await workspace.read();
    assert.equal(after.version, before + 1, "one write, one undo");
    type Rect = { kind: string; start?: number; end?: number; muted?: boolean; sourceIn?: number; width: number; animations?: { phase: string }[]; paints?: { src: string }[] };
    const shots: Rect[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const node = value as Rect;
      if (node.kind === "rect" && node.paints?.some((paint) => paint.src === "assets/broll.mp4")) shots.push(node);
      Object.values(node).forEach(visit);
    };
    visit(after.document.stage);
    assert.equal(shots.length, 2);
    const [quoted, pip] = [...shots].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
    assert.ok(quoted!.start! > 8 && quoted!.start! < 11, `"better hooks" is spoken around 9.5-10.5s, not ${quoted!.start}`);
    assert.ok(quoted!.width >= 1080, "cover fills the frame");
    assert.ok(pip!.width < 1080 / 2 && pip!.sourceIn === 1 && pip!.end === 3);
    assert.ok(shots.every((shot) => shot.muted), "muted over the speaker");
    assert.ok(shots.every((shot) => shot.animations?.map((item) => item.phase).join() === "in,out"), "fades in and out");
    // A wrong beat places nothing and names itself.
    const wrong = await runTool("place_broll", { beats: [{ path: "assets/broll.mp4", start: 2 }, { path: "assets/missing.mp4", start: 4 }] }, { workspace });
    assert.equal(wrong.ok, false);
    assert.match(wrong.content, /Beat 2 \(assets\/missing\.mp4\).*Nothing was placed/);
    assert.equal((await workspace.read()).version, after.version);
    void checkDocument;
  }

  // 6. The verify gate fires on errors after a write, not on warnings or a clean check.
  {
    const { failingCheck } = await import("./tools");
    const error = '<project_state>{}</project_state><check>{"ok":false,"issues":[{"severity":"error","code":"missing-source","node_id":"n1","message":"x"}]}</check>';
    assert.match(failingCheck(error) ?? "", /"code":"missing-source","node_id":"n1"/);
    assert.equal(failingCheck('<check>{"ok":true,"issues":[{"severity":"warning","code":"transparent","message":"x"}]}</check>'), null, "warnings alone do not block");
    assert.equal(failingCheck("<check>ok</check>"), null);
    assert.equal(failingCheck(undefined), null);
    // Only errors the request introduced: one the clip already had does not hold the model back.
    const { checkErrorKeys } = await import("./tools");
    assert.equal(failingCheck(error, checkErrorKeys(error)), null);
    assert.equal(checkErrorKeys(error).size, 1);
  }

  // 7. The system prompt routes by intent to tools that exist, and keeps its promises.
  {
    const { SYSTEM_PROMPT } = await import("./prompt");
    const { clipToolSpecs } = await import("./scope");
    const offered = new Set(clipToolSpecs().map((spec) => spec.name));
    const named = new Set([...SYSTEM_PROMPT.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]));
    for (const word of ["untrusted_data", "user_answer", "clip_context", "project_state", "your_skills"]) named.delete(word);
    for (const name of named) assert.ok(offered.has(name), `the prompt names ${name}, which is not a tool`);
    for (const route of ["create_video", "edit_video", "replace_background", "plan_video", "place_broll", "generate_media", "wait_for_media", "add_3d_scene", "request_export"]) {
      assert.ok(named.has(route), `the routing names ${route}`);
    }
    assert.match(SYSTEM_PROMPT, /independent reads in ONE step/, "parallel reads are asked for");
    assert.ok(SYSTEM_PROMPT.length < 6000, `the prompt stays short (${SYSTEM_PROMPT.length} chars)`);
  }

  console.log("agent-design.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
