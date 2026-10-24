/**
 * Plans written by an outside client (MCP, docs/mcp-on-modal-plan.md A5): `create_video` takes a
 * finished director plan and `plan_video` a finished IntroSpec. No model is called; the same review
 * runs and its notes come back for the client to fix; a good plan prices like the director's.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/client-plans.check.ts
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { pickShotModel, prepareCreateVideo, SEPARATE_SHOTS } from "./create-video";
import { prepareVideo } from "./video-team";

const blank = (width: number, height: number) =>
  ({ version: 1, stage: { children: [{ kind: "scene", name: "Edit", width, height, active: true, children: [] }] } }) as unknown as ClipDocument;

async function main() {
  process.env.OPENCMO_AI_FAKE = "1";
  // With the fake model off, a plan must still skip the director: no model call may happen.
  delete process.env.OPENCMO_AGENT_FAKE;
  const noUsage = async () => {
    throw new Error("a client plan must not call a model");
  };

  // ---------------------------------------------------------------- create_video
  const shot = (seconds: number, words: string, extra: Record<string, unknown> = {}) => ({
    seconds,
    words,
    keyframe: "a laptop on a hotel front desk in a bright lobby, morning light, medium shot",
    motion: "the camera glides toward the desk, the screen lights up, guests pass behind",
    continues: true,
    ...extra,
  });
  const plan = {
    title: "Front desk",
    script: "Your front desk opens itself. Guests check in from their phone, and you get your morning back.",
    style: "cinematic",
    music: "warm acoustic, mid tempo",
    shots: [
      shot(5, "Your front desk opens itself.", { text: "Meet your front desk" }),
      shot(5, "Guests check in from their phone,", { keyframe: "a guest's hand holding a phone at the hotel entrance, morning light, close-up" }),
      shot(5, "and you get your morning back.", { keyframe: "a calm manager with a coffee by the lobby window, morning light, wide shot", continues: false }),
    ],
  };
  const ask = (extra: Record<string, unknown>) => prepareCreateVideo({ prompt: "A hotel front desk app", model: "fake-video", ...extra }, { document: blank(1920, 1080) }, noUsage);
  const fix = async (shots: unknown[], extra: Record<string, unknown> = {}) => String(await ask({ plan: { ...plan, ...extra, shots } }));

  const made = await ask({ plan });
  assert.ok(typeof made !== "string", `a good plan is priced: ${String(made)}`);
  assert.equal(made.storyboard.beats.length, 3);
  assert.equal(made.prepared.longTake?.seconds, 15, "the length comes from the plan's shots");
  assert.ok(made.prepared.lines?.[0]?.includes("15s"), "the card names the length");
  assert.equal(made.prepared.credits, 3, "three keyframes: two continuous shots share theirs, the last is a cut");

  // A plan in the format before long takes gets told the fields, not a zod path.
  const old = await ask({ plan: { ...plan, shots: [{ seconds: 5, idea: "x", subject: "a desk" }] } });
  assert.match(String(old), /^plan: every shot needs words .*keyframe .*motion .*continues/);

  // Review rules, each sent back to the client to fix.
  assert.match(String(await ask({ seconds: 15, plan: { ...plan, shots: plan.shots.slice(0, 2) } })), /^Fix the plan and send it again: .*add up to 10\.0s; make them add up to 15s/, "length");
  assert.match(
    await fix([plan.shots[0], { ...plan.shots[1], words: "Guests check in from the lobby," }, plan.shots[2]]),
    /Shot 2's words do not continue the script/,
    "the beats rejoin to the exact script",
  );
  assert.match(await fix(plan.shots.slice(0, 2)), /The beats stop before the end of the script/, "every word of the script is in a beat");
  assert.match(
    await fix([shot(5, "Meet Open"), shot(5, "Desk, the app that opens your hotel."), shot(5, "Guests love it.", { keyframe: "a lobby at dusk, wide shot" })], {
      script: "Meet Open Desk, the app that opens your hotel. Guests love it.",
    }),
    /split "Open Desk"/,
    "no boundary inside a name",
  );
  assert.match(
    await fix([shot(5, "We saved 40"), shot(5, "percent of check-in time.", { keyframe: "a clock on a lobby wall, close-up" }), shot(5, "Try it.", { keyframe: "a lobby at dusk, wide shot" })], {
      script: "We saved 40 percent of check-in time. Try it.",
    }),
    /split "40 percent"/,
    "no boundary inside a number",
  );
  assert.match(await fix([plan.shots[0], { ...plan.shots[1], keyframe: plan.shots[0]!.keyframe }, plan.shots[2]]), /Shot 2's keyframe repeats shot 1's/, "keyframes change");
  assert.match(
    await fix([shot(4, "Your front desk opens itself."), shot(6, "Guests check in from their phone,"), shot(5, "and you get your morning back.", { continues: false })]),
    /Shot 1 is 4s but is paid as 5s|Shot 1 flows into the next, so it must be exactly one of 3, 5s/,
    "a continuous shot plays its full generated length",
  );
  assert.match(
    String(await ask({ plan: { ...plan, shots: Array.from({ length: 19 }, () => plan.shots[0]) } })),
    /^plan\.shots: /,
    "at most 18 shots",
  );

  // Model pick (F10): the best model that ends on a frame; without one, cuts and the card says so.
  {
    process.env.OPENCMO_AI_FAKE = "";
    process.env.FAL_KEY = "test";
    try {
      for (const aspect of ["9:16", "16:9", "1:1"]) {
        const picked = pickShotModel(aspect);
        assert.ok(typeof picked !== "string" && picked.joins && picked.model.limits.lastFrame, `${aspect}: a model that joins two frames`);
      }
      // Review focus 5: 9:16 and 16:9 on the best model, 1:1 on the one that makes a square.
      const ids = Object.fromEntries(["9:16", "16:9", "1:1"].map((aspect) => [aspect, (pickShotModel(aspect) as { model: { id: string } }).model.id]));
      assert.deepEqual(ids, { "9:16": "fal-veo", "16:9": "fal-veo", "1:1": "fal-kling-v3" });
      const single = pickShotModel("9:16", "gemini-video");
      assert.ok(typeof single !== "string" && !single.joins, "a model without a last frame cannot join");
      assert.equal(pickShotModel("1:1", "gemini-video"), 'Model "gemini-video" cannot make 1:1 video shots from a keyframe.', "never a model that cannot make the frame");
      const cut = await prepareCreateVideo(
        {
          prompt: "A hotel front desk app",
          model: "gemini-video",
          plan: { ...plan, shots: [shot(4, "Your front desk opens itself."), shot(4, "Guests check in from their phone,", { keyframe: "a phone at the entrance, close-up" }), shot(4, "and you get your morning back.", { keyframe: "a lobby window, wide shot" })] },
        },
        { document: blank(1080, 1920) },
        noUsage,
      );
      assert.ok(typeof cut !== "string", String(cut));
      assert.ok(cut.prepared.lines?.includes(SEPARATE_SHOTS), "the fallback adds its line");
      assert.ok(cut.prepared.longTake?.plan.shots.every((item) => !item.continues), "every beat is a cut");
      assert.equal(1 + (cut.prepared.extra?.length ?? 0), 3, "one keyframe per cut shot");
      assert.ok(!cut.prepared.lines?.some((line) => /Veo|Seedance|Kling|Nano Banana|Seedream/.test(line)), "no model name on the card");
    } finally {
      process.env.OPENCMO_AI_FAKE = "1";
      delete process.env.FAL_KEY;
    }
  }

  // ---------------------------------------------------------------- plan_video
  const spec = {
    personality: "premium",
    emotion: "confident",
    seconds: 4,
    background: { style: "gradient" },
    elements: [
      { key: "title", kind: "title", text: "Front desk, solved" },
      { key: "line", kind: "accent_line" },
    ],
    beats: [
      { target: "title", at: 0.2, dur: 0.9, motion: "slide_up" },
      { target: "line", at: 0.7, dur: 0.5, motion: "draw" },
    ],
  };
  const intro = await prepareVideo({ recipe: "intro", spec }, { document: blank(1080, 1920), clipContext: "" }, noUsage);
  assert.ok(typeof intro !== "string", `a good intro spec is planned: ${String(intro)}`);
  assert.equal(intro.prepared.op.op, "add_intro");
  assert.equal(intro.card.credits, 0);
  assert.equal(intro.card.storyboard.beats.length, 2);

  const late = await prepareVideo(
    { recipe: "intro", spec: { ...spec, beats: [{ target: "title", at: 3.9, dur: 0.9, motion: "slide_up" }] } },
    { document: blank(1080, 1920), clipContext: "" },
    noUsage,
  );
  assert.equal(typeof late, "string", "the code Reviewer still checks a client's spec");
  assert.match(String(late), /^Fix the plan and send it again: /);

  console.log("client-plans checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
