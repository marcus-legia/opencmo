import { expect, test } from "@playwright/test";

import { sceneBox, videoRegionStats } from "./canvas";
import { showAssistant, signIn, state } from "./helpers";

/**
 * Explainers (docs/explainer-build.md, acceptance test 3 and 4): on a New edit, /explain shows the
 * script; "go" renders preview stills in the panel and then a price card with the beats; Approve
 * places one layer "Explainer: …" that renders (fake agent, OPENCMO_MOTION=local, fake voice) and
 * plays; Ctrl+Z removes it.
 */

type Doc = { document: { stage: { children: { width: number; height: number; workarea?: number[]; children?: { name?: string; paints?: { src?: { model?: string } }[] }[] }[] } } };

test("New edit: /explain → script → go → stills → approve → the explainer renders and plays", async ({ page }, testInfo) => {
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
  await page.getByLabel("Message the assistant").fill("/explain How Shazam recognizes a song in a noisy bar");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText(/Explainer script[^]*Shall I make it\?/, { timeout: 120_000 });

  await page.getByLabel("Message the assistant").fill("go");
  await page.getByTestId("assistant-send").click();
  // Stills come back from the server render and show in the panel, then the price card.
  await expect(page.getByTestId("assistant-approval")).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".ed2-asst-list img").first()).toBeVisible();
  await expect(page.getByTestId("assistant-approval")).toContainText(/Explainer “.+” · \d+s · 16:9 · voice .+ · \d+ credits?/);
  await expect(page.getByTestId("assistant-approval")).toContainText("Beat 1 · Voice:");
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
  // Playhead at 2 s: a click on the ruler at 2 s of the work area.
  const area = (await page.getByTestId("workarea").boundingBox())!;
  const seconds = scene.workarea?.[1] ?? 30;
  await page.getByTestId("timeline-ruler").click({ position: { x: area.x - (await page.getByTestId("timeline-ruler").boundingBox())!.x + (area.width * 2) / seconds, y: 4 } });
  await expect(page.getByTestId("playhead-time")).toContainText(/^0:02/);
  const box = await sceneBox(page, { width: 1920, height: 1080 });
  // A real frame has texture; an empty or black canvas has std ≈ 0.
  await expect.poll(async () => (await videoRegionStats(page, box)).std, { timeout: 60_000 }).toBeGreaterThan(2);
  await page.screenshot({ path: testInfo.outputPath("02-explainer-playing.png") });

  // Ctrl+Z takes the whole explainer away.
  await page.getByTestId("editor-stage").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => JSON.stringify(await read()), { timeout: 60_000 }).not.toMatch(/"model":"motion-explainer"/);
});
