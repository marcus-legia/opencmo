/**
 * Plans written by an outside client (MCP, docs/mcp-on-modal-plan.md A5): `create_video` takes a
 * finished director plan and `plan_video` a finished IntroSpec. No model is called; the same review
 * runs and its notes come back for the client to fix; a good plan prices like the director's.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/agent/client-plans.check.ts
 */
import assert from "node:assert/strict";

import type { ClipDocument } from "@opencmo/clip-doc";

import { prepareCreateVideo } from "./create-video";
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
  const shot = (seconds: number, extra: Record<string, unknown> = {}) => ({
    seconds,
    idea: "the front desk is ready before guests arrive",
    subject: "a laptop on a hotel front desk",
    action: "the screen lights up",
    setting: "a bright lobby in the morning",
    camera: "slow push-in",
    ...extra,
  });
  const plan = {
    title: "Front desk",
    script: "Your front desk opens itself. Guests check in from their phone, and you get your morning back.",
    style: "cinematic",
    music: "warm acoustic, mid tempo",
    shots: [shot(5, { text: "Meet your front desk" }), shot(5), shot(5)],
  };
  const made = await prepareCreateVideo({ prompt: "A hotel front desk app", model: "fake-video", plan }, { document: blank(1920, 1080) }, noUsage);
  assert.ok(typeof made !== "string", `a good plan is priced: ${String(made)}`);
  assert.equal(made.storyboard.beats.length, 3);
  assert.equal((made.prepared.op as unknown as { seconds: number }).seconds, 15, "the length comes from the plan's shots");
  assert.ok(made.prepared.lines?.[0]?.includes("15s"), "the card names the length");
  assert.ok(made.prepared.credits > 0);

  const tooLong = await prepareCreateVideo(
    { prompt: "A hotel front desk app", model: "fake-video", seconds: 15, plan: { ...plan, shots: [shot(5), shot(5)] } },
    { document: blank(1920, 1080) },
    noUsage,
  );
  assert.equal(typeof tooLong, "string");
  assert.match(String(tooLong), /^Fix the plan and send it again: .*add up to 10\.0s; make them add up to 15s/, "the reviewer's notes go back to the client");

  const chained = await prepareCreateVideo(
    { prompt: "A hotel front desk app", model: "fake-video", plan: { ...plan, shots: [shot(5, { continues: true }), shot(5), shot(5)] } },
    { document: blank(1920, 1080) },
    noUsage,
  );
  assert.match(String(chained), /Shot 1 cannot continue another shot/);

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
