/**
 * How the Assistant is put together, offline: which tool calls may run at the same time, which
 * tools each kind of clip gets, what the system prompt promises, and how the explainer guide draws.
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

  // 7a. Rough cut: find_retakes is a parallel read that reads the clip's transcript, and /roughcut
  // sends the model to its guide with the "ask before cutting" rule.
  {
    const { runTool } = await import("./tools");
    const { memoryWorkspace } = await import("./workspace");
    const { slashDirective } = await import("./slash");
    const { clipToolSpecs } = await import("./scope");
    const { readGuide } = await import("./guides");
    const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, ROUGHCUT_TRANSCRIPT } = await import("./eval/fixture");
    assert.ok(PARALLEL_SAFE.has("find_retakes"));
    const workspace = memoryWorkspace(
      { version: 1, document: fixtureDocument(), manifest: fixtureManifest() },
      { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": ROUGHCUT_TRANSCRIPT }, master: FIXTURE_MASTER },
    );
    const found = await runTool("find_retakes", {}, { workspace });
    assert.equal(found.ok, true, found.content);
    const retakes = (JSON.parse(found.content) as { untrusted_data: { retakes: { drop_word_ids: string[]; text: string }[] } }).untrusted_data.retakes;
    assert.equal(retakes.length, 2, found.content);
    assert.match(retakes[0]!.text, /answer every question/);
    assert.match(retakes[1]!.text, /every day for a month/);
    assert.ok(retakes.every((take) => take.drop_word_ids.length > 0));
    const speaker = clipToolSpecs().map((spec) => spec.name);
    assert.match(slashDirective("/roughcut", speaker), /read_guide "roughcut".*ask before cutting/);
    // A blank edit has no speech to cut: /roughcut is answered, not attempted with tools it lacks.
    const blankTools = clipToolSpecs({ blank: true }).map((spec) => spec.name);
    assert.match(slashDirective("/roughcut", blankTools), /not available here/);
    assert.match(readGuide("roughcut"), /keep the LAST take/);
  }

  // 7b. Any video with a transcript can be read by element_id; results name it; a video still being
  // transcribed (or never) gets an answer that says what to do; <clip_context> lists the videos.
  {
    const { runTool } = await import("./tools");
    const { memoryWorkspace } = await import("./workspace");
    const { clipContextBlock } = await import("./clip-context");
    const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, TRANSCRIPT, SECOND_TALK, SECOND_TRANSCRIPT, addSecondTalk } = await import("./eval/fixture");
    const document = fixtureDocument();
    addSecondTalk(document);
    // A third video, placed but not transcribed yet: its file is still in the automatic queue.
    (document.stage.children[0] as unknown as { children: unknown[] }).children.push({ kind: "video", id: "fresh", src: "assets/fresh.mp4", width: 1080, height: 1920, start: 20, end: 25 });
    const manifest = fixtureManifest();
    manifest.assets.push({ id: "fresh0", path: "assets/fresh.mp4", source: "fresh0", type: "VIDEO", mimeType: "video/mp4", createdAt: "2026-10-15T00:00:00.000Z", cloud: { state: "synced", mediaId: "media-fresh" } } as never);
    const files = { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": TRANSCRIPT, [SECOND_TALK.transcript]: SECOND_TRANSCRIPT }, master: FIXTURE_MASTER };
    const workspace = memoryWorkspace({ version: 1, document, manifest }, { ...files, transcriptStatus: { "media-fresh": "running" } });
    const read = async (input: Record<string, unknown>) => JSON.parse((await runTool("get_transcript", input, { workspace })).content);

    const second = await read({ element_id: SECOND_TALK.id });
    assert.equal(second.untrusted_data.source.element_id, SECOND_TALK.id);
    assert.equal(second.untrusted_data.lines.flat()[0].text, "um", "the second video's own words");
    const main = await read({});
    assert.equal(main.untrusted_data.source.main, true, "no element_id reads the main video");
    const summary = (await runTool("find_filler_words", { element_id: SECOND_TALK.id }, { workspace })).summary;
    assert.match(summary, /of Second take/, "with several videos the summary names the one read");

    const pending = await read({ element_id: "fresh" });
    assert.equal(pending.transcript, "pending");
    assert.match(pending.next, /still being transcribed/);
    const idle = memoryWorkspace({ version: 1, document, manifest }, files);
    const none = JSON.parse((await runTool("get_transcript", { element_id: "fresh" }, { workspace: idle })).content);
    assert.equal(none.transcript, "none");
    assert.match(none.next, /add_captions/);
    const wrong = await runTool("get_transcript", { element_id: "captions0" }, { workspace });
    assert.equal(wrong.ok, false, "an id that is no video stays an error");

    const ctx = await workspace.opContext(document, manifest);
    const block = await clipContextBlock(document, ctx, {}, [{ id: "fresh", name: "fresh.mp4", mediaId: "media-fresh" }]);
    const payload = JSON.parse(/<clip_context>(\{.*?\})\n/s.exec(block)![1]!) as { speech_sources: { id: string; words: unknown; main?: boolean }[] };
    assert.deepEqual(payload.speech_sources.map((source) => source.id), ["video0", SECOND_TALK.id, "fresh"]);
    assert.equal(payload.speech_sources[1]!.words, 8);
    assert.equal(payload.speech_sources[2]!.words, "transcribing…");
    const plain = await clipContextBlock(fixtureDocument(), ctx);
    assert.ok(!plain.includes("speech_sources"), "a clip with only its own video needs no list");

    // A blank New edit with only an upload: the upload's words are the script, at its place on the timeline.
    const blank = fixtureDocument();
    const scene = blank.stage.children[0] as unknown as { children: unknown[] };
    scene.children = [];
    addSecondTalk(blank);
    const uploaded = await clipContextBlock(blank, ctx);
    assert.ok(!uploaded.includes("no_script"), "a spoken upload is a script");
    assert.match(uploaded, /\[10\.\d–1[0-5]\.\d\] um so the second/, "times are clip seconds from where the upload starts");
  }

  // 7. The system prompt routes by intent to tools that exist, and keeps its promises.
  {
    const { SYSTEM_PROMPT } = await import("./prompt");
    const { clipToolSpecs } = await import("./scope");
    const offered = new Set(clipToolSpecs().map((spec) => spec.name));
    const named = new Set([...SYSTEM_PROMPT.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((match) => match[0]));
    for (const word of ["untrusted_data", "user_answer", "clip_context", "project_state", "your_skills"]) named.delete(word);
    for (const name of named) assert.ok(offered.has(name), `the prompt names ${name}, which is not a tool`);
    for (const route of ["create_video", "edit_video", "replace_background", "plan_video", "place_broll", "generate_media", "wait_for_media", "add_3d_scene", "preview_explainer", "add_explainer", "request_export", "find_retakes"]) {
      assert.ok(named.has(route), `the routing names ${route}`);
    }
    assert.match(SYSTEM_PROMPT, /independent reads in ONE step/, "parallel reads are asked for");
    assert.ok(SYSTEM_PROMPT.length < 6000, `the prompt stays short (${SYSTEM_PROMPT.length} chars)`);
  }

  // 8. Explainers draw their subject in scene code (a Mark); icons and Lotties are supporting pieces.
  // The review loop names a missing drawing, so it no longer pushes the model back to icons.
  {
    const { z } = await import("zod");
    const { readGuide } = await import("./guides");
    const { previewExplainerInput } = await import("./explainer-tool");
    const guide = readGuide("explainer");
    for (const text of ["<Mark", "Easing.bezier", "strokeDashoffset", "templates/phone-carousel/scene.jsx", '"beat N shows nothing drawn"']) {
      assert.ok(guide.includes(text), `the explainer guide names ${text}`);
    }
    for (const old of ["The subject's icon in every beat", "icons, built-in Lottie animations or kit shapes", "shows no icon, shape or Lottie"]) {
      assert.ok(!guide.includes(old), `the explainer guide no longer says "${old}"`);
    }
    const schema = JSON.stringify(z.toJSONSchema(previewExplainerInput, { io: "input" }));
    assert.ok(!schema.includes("naming the icons, Lotties or kit shapes"), "beats[].visual asks for a drawing, not icon names");
    assert.ok(schema.includes("a flat disc tilts 30°"), "beats[].visual gives a drawn example");
  }

  console.log("agent-design.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
