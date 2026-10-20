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
  const { createVideoToolSpec, prepareCreateVideo, videoPieces } = await import("./create-video");
  const { generateCard } = await import("./generate-tool");
  const { screenPieces } = await import("./screen-pieces");
  const { slashDirective } = await import("./slash");
  const { SYSTEM_PROMPT } = await import("./prompt");
  const { readGuide } = await import("./guides");
  const { memoryWorkspace } = await import("./workspace");
  const { applyOpTool, runCheck } = await import("./tools");
  const { fixtureDocument, fixtureManifest, FIXTURE_DURATIONS, FIXTURE_MASTER, TRANSCRIPT } = await import("./eval/fixture");

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

  /** Approve: the op `runGeneration` applies after holding the credits, on the same document. */
  async function approve(planned: Awaited<ReturnType<typeof prepareCreateVideo>>, document = blank()) {
    assert.ok(typeof planned !== "string");
    const workspace = memoryWorkspace(
      { version: 1, document, manifest: fixtureManifest() },
      { durations: FIXTURE_DURATIONS, transcripts: { "assets/transcript.json": TRANSCRIPT }, master: FIXTURE_MASTER },
    );
    const outcome = await applyOpTool(planned.prepared.op, { workspace });
    assert.ok(outcome.ok, `the approved video could not be placed: ${outcome.content}`);
    const after = (await workspace.read()).document;
    return { document: after, check: await runCheck(workspace) };
  }

  // 1. "/video a 20-second video introducing a note-taking app" on a New edit.
  {
    const asked = await ask({ prompt: "a 20-second video introducing a note-taking app for students", seconds: 20 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    const [summary, shots, ...rest] = asked.card.changes;
    assert.match(summary!, /^Create a 20s 9:16 video: 4 AI shots, voice-over \(Test A\), music · \d+ credits, ready in about /, summary);
    assert.match(shots!, /^Shots on .+ · 20 credits$/, shots);
    assert.ok(rest.some((line) => line.startsWith("Script: ")), "the card shows the script the voice will read");
    assert.equal(asked.card.credits, asked.planned.prepared.credits);
    assert.equal(asked.card.storyboard.seconds, 20);
    assert.deepEqual(asked.card.storyboard.beats.map((beat) => [beat.at, beat.dur]), [[0, 5], [5, 5], [10, 5], [15, 5]]);
    assert.ok(asked.card.storyboard.beats.every((beat) => beat.motion && beat.motion !== "—"), "every shot has its part of the voice-over");
    // Every piece starts at once on Approve: shots 2-4, the voice and the music ride on the first.
    assert.equal(asked.planned.prepared.extra?.length, 5);

    const { document, check } = await approve(asked.planned);
    const scene = sceneOf(document);
    assert.deepEqual([scene.width, scene.height], [1080, 1920]);
    assert.deepEqual(scene.workarea, [0, 20], "the video is as long as asked");
    assert.equal(count(document, /"generate":"video"/g), 4, "four AI shots on the timeline");
    assert.equal(count(document, /"generate":"voice"/g), 1, "one voice-over");
    assert.ok(count(document, /"kind":"captions"/g) >= 1, "captions follow the voice");
    assert.ok(count(document, /"generate":"audio"/g) >= 1, "a music bed");
    assert.ok(JSON.stringify(document).includes("Meet your new front desk"), "the director's on-screen text is placed");
    assert.equal(check.ok, true, JSON.stringify(check.issues));
  }

  // 2. No length given: 30 s.
  {
    const asked = await ask({ prompt: "a video about our booking app" });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /^Create a 30s 9:16 video: 6 AI shots/);
  }

  // 3. Square and landscape: the frame follows.
  for (const [aspect, size] of [["1:1", [1080, 1080]], ["16:9", [1920, 1080]]] as const) {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10, aspect });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, new RegExp(`^Create a 10s ${aspect} video`));
    const { document } = await approve(asked.planned);
    assert.deepEqual([sceneOf(document).width, sceneOf(document).height], size);
  }

  // 4. The longest video: within the shot limit and still covering 90 s.
  {
    const asked = await ask({ prompt: "a long product tour", seconds: 90 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.equal(asked.card.storyboard.seconds, 90);
    const { document, check } = await approve(asked.planned);
    assert.deepEqual(sceneOf(document).workarea, [0, 90]);
    assert.equal(check.ok, true, JSON.stringify(check.issues));
  }

  // 5. "/video a 5-second outro" (scenario 14): one shot, not a schema error.
  {
    const asked = await ask({ prompt: "a 5-second outro: a laptop on a desk at golden hour", seconds: 5 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /^Create a 5s 9:16 video: 1 AI shot, voice-over \(Test A\), music/);
    const { document, check } = await approve(asked.planned);
    assert.deepEqual(sceneOf(document).workarea, [0, 5]);
    assert.equal(count(document, /"generate":"video"/g), 1);
    assert.equal(check.ok, true, JSON.stringify(check.issues));
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
    assert.equal(asked.error, 'Model "gemini-video" cannot make 1:1 video shots.');
  }

  // 8. Content policy: the block names the piece to rewrite (the voice-over here), before any card.
  {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10 });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.equal(await screenPieces(videoPieces(asked.planned)), null, "a clean plan passes");
    const voice = asked.planned.prepared.extra!.find((item) => item.model.kind === "voice")!;
    voice.spec = { ...voice.spec, prompt: `${String(voice.spec.prompt)} [[flag]]` };
    const blocked = await screenPieces(videoPieces(asked.planned));
    assert.ok(blocked);
    assert.equal(
      JSON.parse(blocked.content).INVALID_INPUT,
      "Against the content policy: The voice-over script. Rewrite it without that content and call create_video again.",
    );
  }

  // 9. A voice the user asked for is the one on the card and in the video.
  {
    const asked = await ask({ prompt: "a video about our booking app", seconds: 10, voice: "Test B" });
    assert.ok(!("error" in asked), "error" in asked ? asked.error : "");
    assert.match(asked.card.changes[0]!, /voice-over \(Test B\)/);
    assert.equal((asked.planned.prepared.op as unknown as { voice?: { voice: string } }).voice?.voice, "Test B");
  }

  // 10. How a request reaches create_video: /video names it; a plain request relies on the prompt.
  {
    assert.match(slashDirective("/video a 20-second video about notes"), /call create_video/);
    assert.equal(slashDirective("make me a 20-second video about notes"), "");
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
