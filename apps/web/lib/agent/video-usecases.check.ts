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
  async function approve(planned: Awaited<ReturnType<typeof prepareCreateVideo>>, document = blank(), options: { failOp?: boolean } = {}) {
    assert.ok(typeof planned !== "string");
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
            assert.equal(request.orderId, "order-1", "every piece is paid from the job's hold");
            return { request, model: { id: request.model } as never, spec: request.spec as never };
          },
          start: async (_supabase, item) => {
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
    // One hold for the estimate, keyframes before shots, the library before the scene, then the job closes.
    assert.equal(calls[0], `credit_order_open:${asked.card.credits}`);
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
    const voice = asked.planned.later.find((piece) => piece.kind === "voice")!;
    voice.spec = { ...voice.spec, prompt: `${String(voice.spec.prompt)} [[flag]]` };
    const blocked = await screenPieces(videoPieces(asked.planned));
    assert.ok(blocked);
    assert.equal(
      JSON.parse(blocked.content).INVALID_INPUT,
      "Against the content policy: The voice-over script. Rewrite it without that content and call create_video again.",
    );
    voice.spec = { ...voice.spec, prompt: String(voice.spec.prompt).replace(" [[flag]]", "") };
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
    assert.match(SYSTEM_PROMPT, /create_video/, "a plain \"make me a video\" must be routed by the system prompt");
    assert.match(readGuide("blank"), /create_video/, "the blank-edit guide must send a whole video to create_video");
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
