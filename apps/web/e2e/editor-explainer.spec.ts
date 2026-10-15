import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { sceneBox, videoRegionStats } from "./canvas";
import { showAssistant, signIn, state } from "./helpers";

/**
 * Explainers (docs/explainer-build.md acceptance tests 3 and 4, v2 in docs/explainer-v2-build.md C6):
 * on a New edit, /explain shows the storyboard with a picture per beat; "go" renders preview stills
 * in the panel and then a price card with the beats and their pictures; Approve places one layer
 * "Explainer: …" that renders (fake agent, OPENCMO_MOTION=local, fake voice) and plays; Ctrl+Z
 * removes it. Once the generation has the voice's word timings, the editor adds a visible captions
 * layer "Captions · …" (one Undo step).
 */

type Child = { id?: string; kind?: string; name?: string; hidden?: boolean; source?: string; src?: unknown; paints?: { src?: { model?: string } }[] };
type Doc = { document: { stage: { children: { width: number; height: number; workarea?: number[]; children?: Child[] }[] } } };

/** The fake vaccine storyboard (`lib/agent/providers/fake-explainers.ts`), in order. */
const BEAT_WORDS = [12, 15, 12, 12, 12, 10];

test("New edit: /explain → storyboard → go → stills → approve → the explainer renders, plays and gets captions", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  page.on("pageerror", (error) => console.log(`[editor] ${error.message}`));
  await signIn(page, state().users.b);

  const created = await page.request.post("/api/v1/editor/new", { data: { aspect: "9:16" } });
  expect(created.status(), await created.text()).toBe(200);
  const { clip_id: clipId } = (await created.json()) as { clip_id: string };
  await page.goto(`/app/editor/${clipId}`);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await showAssistant(page);

  // The New edit starter opens /explain; the user names the concept.
  await page.getByTestId("assistant-explain").click();
  await expect(page.getByLabel("Message the assistant")).toHaveValue("/explain ");
  await page.getByLabel("Message the assistant").fill("/explain How a vaccine teaches your immune system to fight a virus");
  await page.getByTestId("assistant-send").click();
  // The storyboard names the picture of every beat before any code.
  await expect(page.getByTestId("assistant-reply").last()).toContainText(/Explainer script[^]*Picture: a syringe icon[^]*Shall I make it\?/, { timeout: 120_000 });

  await page.getByLabel("Message the assistant").fill("go");
  await page.getByTestId("assistant-send").click();
  // Stills come back from the server render and show in the panel, then the price card.
  await expect(page.getByTestId("assistant-approval")).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".ed2-asst-list img").first()).toBeVisible();
  await expect(page.getByTestId("assistant-approval")).toContainText(/Explainer “.+” · \d+s · 16:9 · paper, playful · voice .+ · \d+ credits?/);
  await expect(page.getByTestId("assistant-approval")).toContainText("Beat 1 · Voice:");
  await expect(page.getByTestId("assistant-approval")).toContainText("Picture: a syringe icon");
  await page.screenshot({ path: testInfo.outputPath("01-explainer-card.png") });
  await page.getByTestId("assistant-approve").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText(/being generated/, { timeout: 120_000 });

  // One layer, full frame: the blank 9:16 edit took the explainer's 16:9 frame and length.
  const read = async () => (await (await page.request.get(`/api/v1/editor/document?clip_id=${clipId}`)).json()) as Doc;
  await expect.poll(async () => JSON.stringify(await read()), { timeout: 60_000 }).toMatch(/"name":"Explainer: [^"]+"/);
  const scene = (await read()).document.stage.children[0]!;
  expect([scene.width, scene.height]).toEqual([1920, 1080]);
  const layers = (scene.children ?? []).filter((child) => child.paints?.some((paint) => paint.src?.model === "motion-explainer"));
  expect(layers).toHaveLength(1);

  // The render finishes (local Remotion, silent voice) and the layer plays.
  await expect(page.locator('[data-testid^="clip-ai-pending-"]')).toHaveCount(0, { timeout: 600_000 });
  await expect(page.locator('[data-testid^="clip-ai-retry-"]')).toHaveCount(0);
  await expect(page.getByText("Loading media…")).toHaveCount(0, { timeout: 60_000 });

  // Verify by looking (CLAUDE.md): the full-size MP4 itself has a picture at 2 s and the voice track.
  const { url, service } = state();
  const rest = (path: string) => page.request.get(`${url}/rest/v1/${path}`, { headers: { apikey: service, authorization: `Bearer ${service}` } });
  const [generation] = (await (await rest(`generations?clip_id=eq.${clipId}&model=eq.motion-explainer&select=status,media_asset_id`)).json()) as { status: string; media_asset_id: string }[];
  expect(generation?.status).toBe("done");
  const [asset] = (await (await rest(`media_assets?id=eq.${generation!.media_asset_id}&select=storage_path`)).json()) as { storage_path: string }[];
  // `storage_path` carries its bucket ("media/<owner>/…").
  const file = await page.request.get(`${url}/storage/v1/object/${asset!.storage_path}`, { headers: { apikey: service, authorization: `Bearer ${service}` } });
  expect(file.status()).toBe(200);
  const mp4 = testInfo.outputPath("explainer.mp4");
  writeFileSync(mp4, await file.body());
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", mp4], { encoding: "utf8" });
  expect(probe).toMatch(/video,1920,1080/);
  expect(probe).toMatch(/audio/);
  const gray = execFileSync("ffmpeg", ["-v", "error", "-ss", "2", "-i", mp4, "-frames:v", "1", "-vf", "scale=96:54", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
  const std = Math.sqrt(gray.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gray.length);
  // A frame with something drawn on it has contrast; a blank or black frame has std ≈ 0.
  expect(std, `frame at 2 s: mean ${mean.toFixed(1)}, std ${std.toFixed(1)}`).toBeGreaterThan(2);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "2", "-i", mp4, "-frames:v", "1", testInfo.outputPath("03-explainer-2s.png")]);
  // The steps board of beat 5, 70% into it. The fake voice has no words, so the kit times words at its estimate
  // (2.4 words/s from the start, `WORDS_PER_SECOND` in clip-motion), not spread over the whole video.
  const boardAt = (BEAT_WORDS.slice(0, 4).reduce((sum, value) => sum + value, 0) + BEAT_WORDS[4]! * 0.7) / 2.4;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", boardAt.toFixed(2), "-i", mp4, "-frames:v", "1", testInfo.outputPath("04-explainer-board.png")]);

  // In the editor too, at the playhead. The bundled Chromium cannot decode H.264, so only real Chrome.
  if (process.env.E2E_CHANNEL !== "chromium") {
    // Playhead at 2 s: a click on the ruler at 2 s of the work area.
    const area = (await page.getByTestId("workarea").boundingBox())!;
    const ruler = (await page.getByTestId("timeline-ruler").boundingBox())!;
    const seconds = scene.workarea?.[1] ?? 30;
    await page.getByTestId("timeline-ruler").click({ position: { x: area.x - ruler.x + (area.width * 2) / seconds, y: 4 } });
    await expect(page.getByTestId("playhead-time")).toContainText(/^0:02/);
    const box = await sceneBox(page, { width: 1920, height: 1080 });
    // The frame at 2 s has the white title over the navy field (std ≈ 24 in the MP4); the bare field of
    // frame 0, or an empty canvas, stays under 10. A low bar would pass on the gradient alone.
    await expect.poll(async () => (await videoRegionStats(page, box)).std, { timeout: 60_000 }).toBeGreaterThan(12);
    await page.screenshot({ path: testInfo.outputPath("02-explainer-playing.png") });
  }

  // Ctrl+Z takes the whole explainer away; redo brings it back.
  await page.getByTestId("editor-stage").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => JSON.stringify(await read()), { timeout: 60_000 }).not.toMatch(/"model":"motion-explainer"/);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => JSON.stringify(await read()), { timeout: 60_000 }).toMatch(/"model":"motion-explainer"/);

  // Captions: the fake voice has no word timings, so give the generation some, as a real voice would
  // (`complete_generation` keeps them for explainers). On the next load the editor adds the layer.
  const words = Array.from({ length: 12 }, (_, index) => ({ text: index === 11 ? "virus." : `word${index}`, start: index * 0.4, end: index * 0.4 + 0.35 }));
  const patched = await page.request.patch(`${url}/rest/v1/media_assets?id=eq.${generation!.media_asset_id}`, {
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json", prefer: "return=minimal" },
    data: { words },
  });
  expect(patched.status(), await patched.text()).toBeLessThan(300);
  await page.reload();
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  const captionsOf = async () => ((await read()).document.stage.children[0]!.children ?? []).filter((child) => child.kind === "captions");
  await expect.poll(async () => (await captionsOf()).map((child) => child.name), { timeout: 60_000 }).toEqual([expect.stringMatching(/^Captions · /)]);
  const [captions] = await captionsOf();
  const explainerId = (await read()).document.stage.children[0]!.children!.find((child) => child.paints?.some((paint) => paint.src?.model === "motion-explainer"))!.id;
  expect(captions!.hidden).toBeUndefined();
  expect(captions!.source).toBe(explainerId);
  expect(String(captions!.src)).toMatch(/^assets\/transcripts\/[0-9a-f]{64}\.json$/);
  await page.screenshot({ path: testInfo.outputPath("05-explainer-captions.png") });

  // The captions are their own Undo step: Ctrl+Z removes them and leaves the explainer.
  await page.getByTestId("editor-stage").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await captionsOf()).length, { timeout: 60_000 }).toBe(0);
  expect(JSON.stringify(await read())).toMatch(/"model":"motion-explainer"/);
});
