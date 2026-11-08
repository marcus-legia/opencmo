/**
 * "Make me a video", from the user's side: for each thing a founder asks /video for, what they get
 * back — the price card and storyboard they approve, or the exact message the Assistant receives
 * when it cannot be done — and, once approved, what lands on the timeline.
 *
 * Offline: the scripted director (`OPENCMO_AGENT_FAKE`) and the fake media catalog
 * (`OPENCMO_AI_FAKE`: fake-video makes 3 s and 5 s shots at 1 credit a second), no database, no
 * money. Which tool a REAL model picks for these requests is measured by
 * `npm run agent:eval -- --provider anthropic --yes --until-card --task video-`.
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

process.env.OPENCMO_AGENT_FAKE = "1";
process.env.OPENCMO_AI_FAKE = "1";
// Only the fake catalog: with a real key in the shell, the real voice or video model would be picked.
delete process.env.ELEVENLABS_API_KEY;
delete process.env.FAL_KEY;
// Any model key turns real moderation on (lib/cmo/agents/registry.ts): the fake must check.
for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "OPENAI_COMPAT_API_KEY"]) delete process.env[key];

type Scene = { width: number; height: number; workarea?: number[]; children: unknown[] };
const sceneOf = (document: ClipDocument) => document.stage.children[0] as unknown as Scene;
const count = (document: ClipDocument, pattern: RegExp) => JSON.stringify(document).match(pattern)?.length ?? 0;

async function main(): Promise<void> {
  const { createVideoToolSpec, GENERATION_ACTIVE_LIMIT, prepareCreateVideo, videoPieces } = await import("./create-video");
  const { priceOf } = await import("@opencmo/editor-core/generate");
  const { specHash } = await import("@/lib/generate/models");
  const { generateCard } = await import("./generate-tool");
  const { screenPieces } = await import("./screen-pieces");
  const { musicModel, slashCommandsFor, slashDirective } = await import("./slash");
  const { clipToolSpecs } = await import("./scope");
  const { SYSTEM_PROMPT } = await import("./prompt");
  const { readGuide } = await import("./guides");
  const { memoryWorkspace } = await import("./workspace");
  const { applyOpTool } = await import("./tools");
  const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, TRANSCRIPT } = await import("./eval/fixture");
  const { runCreateVideo } = await import("./create-video");
  const { withPieces } = await import("./keyframe-library");
  const { ApiError } = await import("@/lib/api/errors");
  const { declarationsOf, resolve } = await import("@/components/editor/generate/useGenerations");

  /** A blank "New edit" (where /video runs): an empty 9:16 scene. */
  const blank = (): ClipDocument => {
    const document = fixtureDocument();
    const scene = sceneOf(document);
    scene.children = [];
    scene.workarea = [0, 10];
    return document;
  };

  /** What the user sees after asking: the card, or the message the Assistant gets back. */
  async function ask(input: Record<string, unknown>, document = blank()) {
    const planned = await prepareCreateVideo(input, { document }, async () => undefined);
    if (typeof planned === "string") return { error: planned } as const;
    return { planned, card: { ...generateCard(planned.prepared, "clip"), storyboard: planned.storyboard } } as const;
  }

  /**
   * Approve the one card through `runCreateVideo`, with the database replaced: the job's hold, each
   * piece started from it (keyframes first), the library records, then the op on the same document.
   */
  /** jsonb's key order (shorter keys first, then bytewise), which the op has after `agent_tool_calls.input`. */
  const jsonb = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(jsonb)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, jsonb(item)]),
          )
        : value;

  async function approve(
    planned: Awaited<ReturnType<typeof prepareCreateVideo>>,
    document = blank(),
    options: { failOp?: boolean; failCheck?: number; running?: number; failStart?: number; sent?: number } = {},
  ) {
    assert.ok(typeof planned !== "string");
    // The approval runs on the stored input, as loop.ts and Studio do, not on the in-memory card.
    planned = { ...planned, prepared: { ...planned.prepared, op: jsonb(planned.prepared.op) as never } };
    const workspace = memoryWorkspace(
      { version: 1, document, manifest: fixtureManifest() },
      { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": TRANSCRIPT }, master: FIXTURE_MASTER },
    );
    const calls: string[] = [];
    let manifest: unknown = fixtureManifest();
    let next = 0;
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push(name === "credit_order_open" ? `${name}:${String(args.p_estimate)}` : name);
        if (name === "cancel_generation") {
          // The first `sent` pieces were already sent to their provider: cancelling them keeps their credits.
          const index = Number(String(args.p_id).slice(-12));
          return { data: { sent_at: index < (options.sent ?? 0) ? "2026-11-06T00:00:00Z" : null }, error: null };
        }
        return { data: name === "credit_order_open" ? { id: "order-1" } : 0, error: null };
      },
    };
    const outcome = await runCreateVideo(
      {
        supabase: supabase as never,
        jobId: "job",
        clipId: "clip",
        source: { kind: "agent_turn", id: "turn" },
        applyOp: async (op) => {
          calls.push("place");
          return options.failOp ? { ok: false, content: "{}", summary: "The clip changed." } : applyOpTool(op, { workspace });
        },
        store: {
          read: async () => ({ version: 1, document: (await workspace.read()).document, manifest }),
          write: async (_version, _document, written) => {
            calls.push("library");
            manifest = written;
          },
        },
        create: {
          check: async (_supabase, request) => {
            calls.push("check");
            assert.equal(request.orderId, undefined, "every piece is checked before the job holds anything");
            const after = (request.spec as { startAfter?: string }).startAfter;
            if (after) assert.ok(request.batch?.has(after), "a shot's keyframe is in the batch checked with it");
            if (calls.filter((call) => call === "check").length === options.failCheck) throw new ApiError(503, "Could not check this request. Please try again.");
            return { request, model: { id: request.model } as never, spec: request.spec as never };
          },
          running: async () => options.running ?? 0,
          start: async (_supabase, item) => {
            assert.equal(item.request.orderId, "order-1", "every piece is paid from the job's hold");
            if (next === options.failStart) throw new ApiError(409, "Too many generations are running.");
            calls.push(`start:${(item.spec as { startAfter?: string }).startAfter ? "shot" : "piece"}`);
            return { generation: { id: `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`, credits_reserved: 1 } as never, reused: false };
          },
        },
      },
      planned.prepared,
    );
    return { outcome, calls, document: (await workspace.read()).document, manifest: manifest as ReturnType<typeof withPieces> };
  }

  // 1. "/video a 20-second video introducing a note-taking app" on a New edit: ONE card prices the
  // whole video, and approving it starts everything at once.
  {
    const asked = await ask({ prompt: "a 20-second video introducing a note-taking app for students", seconds: 20 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    const [summary, parts, flow, once, ...rest] = asked.card.changes;
    assert.match(summary!, /^Create a 20s 9:16 video: 4 shots on 5 keyframes, voice-over \(Test A\), music · (\d+) credits · ready in about .+$/, summary);
    assert.match(parts!, /^5 keyframes · 5 credits · 4 shots · \d+ credits$/, parts);
    assert.equal(flow, "Shots flow from one keyframe into the next, with 1 cut where the story changes place");
    assert.match(once!, /^One approval makes the whole video/);
    assert.ok(!asked.card.changes.some((line) => /Test video|Test image/.test(line)), "the card names no model");
    assert.ok(rest.some((line) => line.startsWith("Script: ")), "the card shows the script the voice will read");
    const runs = [{ model: asked.planned.prepared.model, spec: asked.planned.prepared.spec }, ...(asked.planned.prepared.extra ?? [])];
    assert.equal(asked.card.credits, runs.reduce((sum, run) => sum + priceOf(run.model, run.spec), 0), "the price is every piece: keyframes, shots, voice, music");
    assert.equal(Number(/· (\d+) credits ·/.exec(summary!)![1]), asked.card.credits);
    assert.deepEqual(runs.map((run) => run.model.kind), ["image", "image", "image", "image", "image", "video", "video", "video", "video", "voice", "audio"]);
    assert.equal(asked.card.storyboard.seconds, 20);
    assert.deepEqual(asked.card.storyboard.beats.map((beat) => [beat.at, beat.dur]), [[0, 5], [5, 5], [10, 5], [15, 5]]);
    assert.ok(asked.card.storyboard.beats.every((beat) => beat.motion && beat.motion !== "—"), "every beat has its part of the voice-over");
    assert.match(asked.card.storyboard.beats[2]!.label, /^✂ cut · /, "the beat after a hard cut is marked");
    // Each shot waits for the keyframes it joins; the cut before beat 3 leaves shot 2 without an end frame.
    const hashes = runs.slice(0, 5).map((run) => specHash(run.model.id, run.spec));
    assert.deepEqual(
      runs.slice(5, 9).map((run) => [hashes.indexOf(String(run.spec.startAfter)), run.spec.endAfter ? hashes.indexOf(String(run.spec.endAfter)) : null]),
      [[0, 1], [1, null], [2, 3], [3, 4]],
    );
    // Every keyframe, shot, the script and the music are moderated before the card, each named on its own.
    const labels = videoPieces(asked.planned).map((piece) => piece.label);
    assert.equal(labels.length, 5 + 4 + 2);
    assert.match(labels[2]!, /^Keyframe 3 \(/);
    assert.match(labels[5]!, /^Shot 1 \(/);

    const { outcome, calls, document, manifest } = await approve(asked.planned);
    assert.ok(outcome.outcome.ok, outcome.outcome.content);
    // Every piece checked, then one hold for the estimate, keyframes before shots, the library before the scene, then the job closes.
    assert.deepEqual(calls.slice(0, 12), [...Array(11).fill("check"), `credit_order_open:${asked.card.credits}`]);
    assert.deepEqual(calls.filter((call) => call.startsWith("start:")), [...Array(5).fill("start:piece"), ...Array(4).fill("start:shot"), "start:piece", "start:piece"]);
    assert.ok(calls.indexOf("library") < calls.indexOf("place"), "listed before the scene names them");
    assert.equal(calls.at(-1), "credit_order_close");
    const scene = sceneOf(document);
    assert.deepEqual([scene.width, scene.height], [1080, 1920]);
    assert.equal(count(document, /"generate":"video"/g), 4, "the four shots are placed at once");
    const keyframes = manifest.assets.filter((record) => record.path.startsWith("Generated/Fake video/keyframes/"));
    assert.deepEqual(keyframes.map((record) => record.path.split("/").pop()!.slice(0, 3)).sort(), ["01 ", "02 ", "03 ", "04 ", "05 "]);
    // The editor finds each placed shot by its own key and waits on the generation already paid for: it never asks again.
    const listed = new Map(manifest.assets.map((record) => [record.generation?.key, record.generation?.id]));
    const shots = declarationsOf(document).filter((declaration) => declaration.generate === "video");
    assert.equal(shots.length, 4);
    for (const declaration of shots) assert.ok(listed.get(JSON.stringify(resolve(declaration))), `shot ${declaration.prompt.slice(0, 30)} is listed with its generation`);
    for (const declaration of shots) {
      const start = declaration.startFrame as Parameters<typeof resolve>[0];
      assert.ok(listed.get(JSON.stringify(resolve(start))), "its keyframe is listed with its generation");
    }
    // Listing them twice (a retried save) adds nothing.
    assert.equal(withPieces(manifest, "x", [{ key: [...listed.keys()][0]!, type: "IMAGE", name: "y", id: "z" }], "").assets.length, manifest.assets.length);

    // The clip changed under the card: every piece started is cancelled and the job's hold comes back.
    const failed = await approve(asked.planned, blank(), { failOp: true });
    assert.equal(failed.outcome.outcome.ok, false);
    assert.equal(failed.calls.filter((call) => call === "cancel_generation").length, 11);
    assert.equal(failed.calls.at(-1), "credit_order_close");

    // Review 2026-11-06: a refusal found after the keyframes started cost their credits. Every check now runs first.
    const refused = await approve(asked.planned, blank(), { failCheck: 8 });
    assert.equal(refused.outcome.outcome.ok, false);
    assert.ok(!refused.calls.some((call) => call.startsWith("start:") || call.startsWith("credit_order_open")), "a shot refused by its check starts nothing and holds nothing");
    assert.match(refused.outcome.outcome.content, /Please try again|Nothing was charged/);
    const busy = await approve(asked.planned, blank(), { running: 35 });
    assert.equal(busy.outcome.outcome.ok, false);
    assert.ok(!busy.calls.some((call) => call.startsWith("start:")), "the in-flight cap is read before anything starts");
    assert.match(busy.outcome.outcome.content, /needs 11 generations at once and 35 are still running/);
    // A start refused halfway: the reply says which credits stayed with the pieces already sent, never "returned" for all.
    const half = await approve(asked.planned, blank(), { failStart: 6, sent: 2 });
    assert.equal(half.outcome.outcome.ok, false);
    assert.equal(half.calls.filter((call) => call === "cancel_generation").length, 6);
    assert.match(half.outcome.outcome.content, /2 credits for pieces already sent to be made were kept; the rest came back/);
    const clean = await approve(asked.planned, blank(), { failStart: 6 });
    assert.match(clean.outcome.outcome.content, /Your credits were returned/);
  }

  // 2. No length given: 30 s, six beats, the last ending on a closing keyframe.
  {
    const asked = await ask({ prompt: "a video about our booking app" });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /^Create a 30s 9:16 video: 6 shots on 7 keyframes/);
    assert.equal(asked.planned.prepared.library!.names.length, 7, "one generation per keyframe");
  }
  // A minute: twelve beats, thirteen keyframes, all priced on the one card.
  {
    const asked = await ask({ prompt: "a one-minute tour of our booking app", seconds: 60 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /^Create a 60s 9:16 video: 12 shots on 13 keyframes/);
    // fake-video is 1 credit a second and makes 5 s shots; the keyframes, voice and music add their own.
    const shots = asked.planned.later.filter((piece) => piece.kind === "video").length;
    assert.equal(shots, 12);
    assert.ok(asked.card.credits! >= 60 + 13, "at least the 60 shot seconds and the keyframes");
  }

  // 3. Square and landscape: the frame follows.
  for (const [aspect, size] of [["1:1", [1080, 1080]], ["16:9", [1920, 1080]]] as const) {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10, aspect });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, new RegExp(`^Create a 10s ${aspect} video`));
    assert.equal(asked.planned.prepared.spec.aspectRatio, aspect, "keyframes in the video's frame");
    const { document } = await approve(asked.planned);
    assert.deepEqual([sceneOf(document).width, sceneOf(document).height], size);
  }

  // 4. The longest video: within the shot limit, with one keyframe more at most.
  {
    const asked = await ask({ prompt: "a long product tour", seconds: 90 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.equal(asked.card.storyboard.seconds, 90);
    assert.ok(asked.planned.prepared.library!.names.length <= 19);
    // The whole video is in flight at once: within what one user may run.
    assert.ok(1 + (asked.planned.prepared.extra?.length ?? 0) <= GENERATION_ACTIVE_LIMIT);
  }

  // 5. "/video a 5-second outro" (scenario 14): one shot, two keyframes, not a schema error.
  {
    const asked = await ask({ prompt: "a 5-second outro: a laptop on a desk at golden hour", seconds: 5 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /^Create a 5s 9:16 video: 1 shot on 2 keyframes, voice-over \(Test A\), music/);
  }
  // Below what a model can make, the Assistant is told the range.
  {
    const asked = await ask({ prompt: "a 2-second sting", seconds: 2 });
    assert.ok("error" in asked);
    assert.match(asked.error ?? "", /^seconds: /);
  }

  // 6. /video on the user's own clip: refused with where to go instead, nothing planned or charged.
  {
    const asked = await ask({ prompt: "a video about this", seconds: 10 }, fixtureDocument());
    assert.ok("error" in asked);
    assert.equal(asked.error, "/video makes a whole new video. Start a New edit for it; on this clip, use /broll or /image for AI shots.");
  }

  // 7. A model the user named that this catalog does not have for the frame.
  {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10, aspect: "1:1", model: "gemini-video" });
    assert.ok("error" in asked);
    assert.equal(asked.error, 'Model "gemini-video" cannot make 1:1 video shots from a keyframe.');
  }

  // 8. Content policy: the block names the piece to rewrite, before any card.
  {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.equal(await screenPieces(videoPieces(asked.planned)), null, "a clean plan passes");
    // Voice-over scripts are not screened (D8: Creem does not require it, and we add no check of our own).
    const voice = asked.planned.later.find((piece) => piece.kind === "voice")!;
    voice.spec = { ...voice.spec, prompt: `${String(voice.spec.prompt)} [[flag]]` };
    assert.equal(await screenPieces(videoPieces(asked.planned)), null, "the script is heard, not drawn");
    voice.spec = { ...voice.spec, prompt: String(voice.spec.prompt).replace(" [[flag]]", "") };
    const shot = asked.planned.later.find((piece) => piece.kind === "video")!;
    shot.spec = { ...shot.spec, prompt: `${String(shot.spec.prompt)} [[flag]]` };
    const blocked = await screenPieces(videoPieces(asked.planned));
    assert.ok(blocked);
    assert.match(JSON.parse(blocked.content).INVALID_INPUT, /^Against the content policy: Shot 1 \(.+\)\. Rewrite it without that content and call create_video again\.$/);
    shot.spec = { ...shot.spec, prompt: String(shot.spec.prompt).replace(" [[flag]]", "") };
    const second = asked.planned.prepared.extra![0]!;
    second.spec = { ...second.spec, prompt: `${String(second.spec.prompt)} [[flag]]` };
    const keyframe = await screenPieces(videoPieces(asked.planned));
    assert.match(JSON.parse(keyframe!.content).INVALID_INPUT, /^Against the content policy: Keyframe 2 \(/);
  }

  // 9. A voice the user asked for is the one on the card and the one made.
  {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10, voice: "Test B" });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /voice-over \(Test B\)/);
    assert.equal(asked.planned.later.find((piece) => piece.kind === "voice")?.spec.voice, "Test B");
    assert.equal(asked.planned.prepared.longTake?.voice, "Test B");
  }

  // 9b. A voice no model speaks is refused before any planning: dropped silently, the video had no voice.
  {
    const asked = await ask({ prompt: "a 20-second video about a notes app", seconds: 20, voice: "Narrator" });
    if (!("error" in asked) || !asked.error) assert.fail("an unknown voice is refused");
    assert.match(asked.error, /voice: choose one of/);
  }

  // 10. How a request reaches create_video: /video names it; a plain request relies on the prompt.
  {
    const tools = clipToolSpecs().map((spec) => spec.name);
    assert.match(slashDirective("/video a 20-second video about notes", tools), /call create_video/);
    assert.equal(slashDirective("make me a 20-second video about notes", tools), "");
    // /music asks for the music model by name: the first audio model makes 22 s sound effects.
    const { AI_MODELS } = await import("@opencmo/editor-core/generate");
    assert.equal(musicModel(AI_MODELS), "elevenlabs-music", "the music model, not the first audio model (sound effects)");
    assert.match(slashDirective("/music calm lo-fi", tools), new RegExp(`model "${musicModel()}"`));
    // Without the tool (no video model on the server) the menu drops /video and the directive says so.
    const noVideo = tools.filter((name) => name !== "create_video");
    assert.ok(!slashCommandsFor(noVideo).some((command) => command.name === "video"));
    assert.match(slashDirective("/video a clip", noVideo), /not available here/);
    // `/video` hidden in the web app (cmo-review-2 §2.2): the Assistant has no create_video, its menu drops /video, and
    // neither the prompt nor the blank guide offers a whole AI video. MCP still lists the tool.
    const { CREATE_VIDEO_HIDDEN } = await import("./hidden");
    const web = clipToolSpecs({ assistant: true }).map((spec) => spec.name);
    if (CREATE_VIDEO_HIDDEN) {
      assert.ok(!web.includes("create_video") && tools.includes("create_video"), "hidden from the Assistant, kept for MCP");
      assert.ok(!slashCommandsFor(web).some((command) => command.name === "video"), "the slash menu drops /video");
      assert.match(slashDirective("/video a clip", web), /not available here/);
      assert.ok(!SYSTEM_PROMPT.includes("create_video") && !SYSTEM_PROMPT.includes("/video"), "the prompt does not offer a whole AI video");
      assert.match(SYSTEM_PROMPT, /whole AI video from one prompt is not made here/);
      assert.ok(!readGuide("blank").includes("create_video"), "the blank-edit guide does not send a whole video to create_video");
      // Every other command stays exactly as it was.
      const names = (list: readonly string[]) => slashCommandsFor(list).map((command) => command.name);
      assert.deepEqual(names(web), names(tools).filter((name) => name !== "video"), "only /video is hidden");
    } else {
      assert.match(SYSTEM_PROMPT, /create_video/, "a plain \"make me a video\" must be routed by the system prompt");
      assert.match(readGuide("blank"), /create_video/, "the blank-edit guide must send a whole video to create_video");
    }
    // The editor can export (request_export): a prompt that says otherwise makes the model refuse "export it".
    assert.match(SYSTEM_PROMPT, /request_export/);
    assert.doesNotMatch(SYSTEM_PROMPT, /cannot (export|render)/i);
  }

  // 11. The tool is offered with a price card, and not at all without a video model.
  {
    const spec = createVideoToolSpec();
    assert.ok(spec);
    assert.equal(spec.approval, true);
    assert.equal(spec.strict, true);
    // Strict schemas drop minimum/maximum: the model only learns the range from the description.
    const seconds = (spec.schema as { properties: { seconds: { description?: string } } }).properties.seconds;
    assert.match(seconds.description ?? "", /5 to 90/);
    // No video provider key on this server (fal is the one that makes text-to-video shots).
    const fal = process.env.FAL_KEY;
    process.env.OPENCMO_AI_FAKE = "";
    delete process.env.FAL_KEY;
    try {
      assert.equal(createVideoToolSpec(), null, "no video model, no /video tool");
    } finally {
      process.env.OPENCMO_AI_FAKE = "1";
      if (fal !== undefined) process.env.FAL_KEY = fal;
    }
  }

  console.log("video-usecases.check: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
