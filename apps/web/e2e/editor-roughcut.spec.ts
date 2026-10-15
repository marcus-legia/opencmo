import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./global-setup";
import { showAssistant, signIn, state } from "./helpers";

/**
 * Rough cut of the user's own recording (plan `docs/own-video-editing-build.md`, C6): a talk
 * uploaded into a New edit, with a known transcript — a filler, a 2 s pause, a false start and a
 * sentence said twice. "Rough cut my video" → the plan is shown → "go" → the earlier takes, the
 * filler and the pause are cut from THAT video, the last take stays → one Undo restores it.
 *
 * The whole path is the real one: the upload is transcribed automatically and for free (Track A; the
 * e2e worker's fake transcriber reads `fixtures/<file name>.transcript.json`), the editor links the
 * transcript to the placed video (Track B4), and the fake Assistant (`providers/fake.ts`) scripts
 * /roughcut. Not in CI (there is no e2e job); run it with `npm run test:e2e -- editor-roughcut`.
 */

type Word = { text: string; start: number; end: number };
type Line = { text: string; words: Word[] };

/** Words spread evenly over [start, end), FILE seconds of the upload. */
function line(text: string, start: number, end: number): Line {
  const words = text.split(" ");
  const step = (end - start) / words.length;
  return {
    text,
    words: words.map((word, index) => ({ text: word, start: round(start + index * step), end: round(start + (index + 0.85) * step) })),
  };
}
const round = (value: number) => Math.round(value * 100) / 100;

/** Fits the New edit's 10 s work area. */
const TALK: Line[] = [
  line("Here is how I got my first customers", 0.2, 2.0),
  line("um", 2.1, 2.4),
  // Pause 2.4 → 4.4
  line("The trick was to", 4.4, 5.2),
  line("The trick was to answer every question", 5.5, 7.0),
  line("I wrote one helpful reply a day", 7.2, 8.4),
  line("I wrote one helpful reply every day", 8.6, 9.8),
];
const FALSE_START = TALK[2]!;
const FIRST_TAKE = TALK[4]!;
const KEPT = [TALK[0]!, TALK[3]!, TALK[5]!];

type Node = { id?: string; kind?: string; src?: string; source?: string; paints?: { type?: string; src?: string }[]; marks?: Record<string, unknown>; children?: Node[] };

function nodes(root: unknown): Node[] {
  const out: Node[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    if (typeof node.kind === "string") out.push(node);
    Object.values(node).forEach(visit);
  };
  visit(root);
  return out;
}

const NAME = "roughcut-talk.mp4";
const balance = async (page: Page) => ((await (await page.request.get("/api/v1/account")).json()) as { credits: number }).credits;

const after0 = (read: { document: unknown }) => read.document;

async function readDocument(page: Page, clipId: string) {
  const response = await page.request.get(`/api/v1/editor/document?clip_id=${clipId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { version: number; document: { stage: { children: { workarea?: [number, number] }[] } } };
}

/** The source ranges cut from the upload (its `text-cut` mark), [] while it is uncut. */
function removedFrom(document: unknown, id: string): { start: number; end: number }[] {
  const node = nodes(document).find((item) => item.id === id);
  return ((node?.marks?.["text-cut"] as { removed?: { start: number; end: number }[] } | undefined)?.removed) ?? [];
}
/** Cut when its middle is inside a removed range (the editor's own rule for a word). */
const cut = (word: Word, removed: { start: number; end: number }[]) => removed.some((range) => range.start <= (word.start + word.end) / 2 && (word.start + word.end) / 2 < range.end);

test("Rough cut: /roughcut proposes, cuts retakes, filler and pause from the upload, one Undo", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  page.on("pageerror", (error) => console.log(`[editor] ${error.message}`));
  const user = state().users.a;
  await signIn(page, user);

  // A New edit of its own, so the other specs' edits do not matter.
  const created = await page.request.post("/api/v1/editor/new", { data: { aspect: "9:16", name: "Rough cut e2e" } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const clipId = ((await created.json()) as { clip_id: string }).clip_id;
  await page.goto(`/app/editor/${clipId}`);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Loading media…")).toHaveCount(0, { timeout: 60_000 });

  // The recording: 10 s with sound. Its words come from TALK (the fake transcriber's sidecar), not the audio.
  writeFileSync(join(FIXTURE_DIR, `${NAME}.transcript.json`), JSON.stringify(TALK));
  const talk = testInfo.outputPath(NAME);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=640x360:r=15:d=10", "-f", "lavfi", "-i", "sine=f=220:d=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", talk,
  ]);
  const credits = await balance(page);
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByTestId("import-input").setInputFiles(talk);
  const row = page.getByTestId(`asset-${NAME}`);
  await expect(row).toBeVisible();
  await row.locator(".ed2-lib-icon").dblclick();
  const placed = async () => nodes((await readDocument(page, clipId)).document).find((node) => node.paints?.some((paint) => paint.type === "video" && paint.src?.endsWith(NAME)));
  await expect.poll(async () => Boolean(await placed()), { timeout: 60_000 }).toBe(true);
  const videoId = (await placed())!.id!;

  // Transcribed with no click and no credits; the editor links it to the placed video on its own.
  await expect(row.getByTestId("transcript-ready")).toBeVisible({ timeout: 180_000 });
  await expect
    .poll(async () => nodes((await readDocument(page, clipId)).document).some((node) => node.kind === "captions" && node.source === videoId), { timeout: 60_000 })
    .toBe(true);
  expect(await balance(page), "the automatic transcript is free").toBe(credits);
  await page.screenshot({ path: testInfo.outputPath("00-transcript-ready.png") });
  const fullLength = (await readDocument(page, clipId)).document.stage.children[0]!.workarea?.[1] ?? 0;
  expect(fullLength).toBeGreaterThanOrEqual(9.9);

  // 1–2. The starter sends /roughcut; the Assistant proposes and waits.
  await showAssistant(page);
  await page.getByTestId("assistant-roughcut").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText("Rough cut plan", { timeout: 60_000 });
  await expect(page.getByTestId("assistant-reply").last()).toContainText("Shall I cut it?");
  expect(removedFrom((await readDocument(page, clipId)).document, videoId), "nothing is cut before the go").toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("01-plan.png") });

  // 3. "go": retakes and filler in one remove_words, then the pauses.
  await page.getByLabel("Message the assistant").fill("go");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText("Rough cut done", { timeout: 120_000 });
  await expect(page.getByTestId("assistant-undo")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("02-cut.png") });

  // The cut's segments are the same video: no new transcript layers appear for them.
  const layers = nodes(after0(await readDocument(page, clipId))).filter((node) => node.kind === "captions");
  expect(layers.length, "one transcript layer for the upload, none for its cut segments").toBe(1);

  // 4. Shorter by what went; the earlier takes, the filler and the pause are gone, the last take stays.
  const after = await readDocument(page, clipId);
  const removed = removedFrom(after.document, videoId);
  for (const word of [...FALSE_START.words, ...FIRST_TAKE.words, ...TALK[1]!.words]) {
    expect(cut(word, removed), `"${word.text}" at ${word.start}s should be cut`).toBe(true);
  }
  for (const word of KEPT.flatMap((item) => item.words)) {
    expect(cut(word, removed), `"${word.text}" at ${word.start}s should stay`).toBe(false);
  }
  expect(removed.some((range) => range.start <= 2.6 && range.end >= 4.2), "the 2 s pause is trimmed").toBe(true);
  const shorter = after.document.stage.children[0]!.workarea?.[1] ?? fullLength;
  // The filler, the pause, the false start and the first take come to about 5 s of the 10.
  expect(fullLength - shorter).toBeGreaterThan(3.5);
  expect(fullLength - shorter, "a rough cut never takes most of the talk").toBeLessThan(6);

  // 5. One Undo puts the whole request back.
  await page.getByTestId("assistant-undo").click();
  await expect.poll(async () => removedFrom((await readDocument(page, clipId)).document, videoId).length, { timeout: 60_000 }).toBe(0);
  await expect.poll(async () => (await readDocument(page, clipId)).document.stage.children[0]!.workarea?.[1], { timeout: 30_000 }).toBe(fullLength);
  await page.screenshot({ path: testInfo.outputPath("03-undone.png") });
});
