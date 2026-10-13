/**
 * What founders actually ask the editor for, run end to end with real models. Each scenario
 * starts from the engine's first cut of the same clip, records what the user would see
 * (problems, credits, time) to .scenarios-out/report.jsonl, and exports where the result is a video.
 * Soft expectations: one failing step does not hide the next scenario's bugs.
 */
import { expect, test, type Page } from "@playwright/test";

import { admin, ask, exportClip, makeClip, newEdit, openEditor, problems, record, resetClip, signIn, state, type TurnResult } from "./lib";

// Not serial: a scenario that finds bugs must not skip the ones after it. One worker keeps the order.

let page: Page;
let clipId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // "Leave site? Changes you made may not be saved": a user moving on clicks Leave.
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page);
  clipId = (process.env.SCENARIO_FRESH === "1" ? null : await lastClip()) ?? (await makeClip(page, state().video));
});

/** The first clip of the user's latest finished clip job: cutting the video again costs minutes. */
async function lastClip(): Promise<string | null> {
  const { data: jobs } = await admin().from("jobs").select("id").eq("user_id", state().userId).eq("kind", "clip").eq("status", "done").order("created_at", { ascending: false }).limit(1);
  if (!jobs?.length) return null;
  const { data: clips } = await admin().from("clips").select("id").eq("job_id", jobs[0]!.id).order("created_at").limit(1);
  return clips?.[0]?.id ?? null;
}

test.afterAll(async () => {
  await page.close();
});

async function fresh(): Promise<void> {
  await resetClip(page, clipId);
  await openEditor(page, clipId);
}

function report(name: string, result: TurnResult, extra: Record<string, unknown> = {}): void {
  const found = problems(result);
  record(name, { problems: found, ...result, ...extra });
  expect.soft(found, `${name}: ${found.join(" | ")}`).toEqual([]);
}

const usedAny = (result: TurnResult, names: string[]) => result.tools.some((tool) => names.includes(tool.name) && tool.status === "done");

test("1. talking-head short: best part, hook title, bold captions", async () => {
  await fresh();
  const result = await ask(page, "Turn this into a punchy short for TikTok: keep the strongest 30 seconds, put a bold hook title on screen for the first 3 seconds, and use big Hormozi-style captions.");
  report("hook-short", result, { export: await exportClip(page, "hook-short") });
  expect.soft(usedAny(result, ["trim_element", "remove_ranges", "set_workarea", "ripple_delete", "remove_words"]), "cut to the best part").toBe(true);
  expect.soft(usedAny(result, ["add_text"]), "hook title").toBe(true);
  expect.soft(usedAny(result, ["set_caption_style"]), "caption style").toBe(true);
});

test("2. podcast cleanup: silences and filler words", async () => {
  await fresh();
  const result = await ask(page, "Clean this up: cut the long pauses and the filler words like uh and um.");
  report("cleanup", result, { export: await exportClip(page, "cleanup") });
  expect.soft(usedAny(result, ["remove_silence", "remove_words", "remove_ranges"]), "removed something").toBe(true);
});

test("3. explainer: /animate the main points", async () => {
  await fresh();
  const result = await ask(page, "/animate illustrate my main points with simple diagrams and icons so it is easy to follow");
  report("animate", result, { export: await exportClip(page, "animate") });
  expect.soft(usedAny(result, ["add_diagram", "add_icon", "add_chart", "add_graph", "add_lottie", "add_3d_scene"]), "drew visuals").toBe(true);
});

test("4. fake set: /background on the whole clip", async () => {
  await fresh();
  const result = await ask(page, "/background replace the room behind me with a clean, bright modern home office");
  report("background", result, { export: await exportClip(page, "background") });
  expect.soft(result.approvals.length, "price shown before spending").toBeGreaterThan(0);
  expect.soft(result.generations.some((g) => g.status === "done"), "cut-out and background made").toBe(true);
});

test("5. background on the intro of a clip that has a split later", async () => {
  await fresh();
  const split = await ask(page, "Use a split layout with me at the bottom from second 5 to the end; leave the first 5 seconds full screen.");
  report("split-then-background (split)", split);
  const result = await ask(page, "/background change the background to a bright studio, only for the first 4 seconds");
  report("split-then-background", result, { export: await exportClip(page, "split-then-background") });
  expect.soft(result.tools.filter((tool) => tool.name === "replace_background" && tool.error?.includes("layout")), "not refused because of the later split").toEqual([]);
});

test("6. B-roll over the talk", async () => {
  await fresh();
  const result = await ask(page, "/broll add one short B-roll shot in the middle that illustrates what I'm talking about");
  report("broll", result, { export: await exportClip(page, "broll") });
  expect.soft(result.generations.some((g) => g.kind === "video" && g.status === "done"), "B-roll video made").toBe(true);
});

test("7. UGC ad: title, CTA, square version", async () => {
  await fresh();
  const result = await ask(page, "Make this work as an ad: a title at the start, a 'Try OpenCMO free' call to action at the end, and switch the frame to 1:1.");
  report("ugc-ad", result, { export: await exportClip(page, "ugc-ad") });
  expect.soft(usedAny(result, ["set_frame"]), "1:1 frame").toBe(true);
});

test("8. listicle: number each point on screen", async () => {
  await fresh();
  const result = await ask(page, "Number each of my main points on screen (1, 2, 3...) right when I start saying them.");
  report("listicle", result, { export: await exportClip(page, "listicle") });
  expect.soft(usedAny(result, ["add_text"]), "numbers on screen").toBe(true);
});

test("9. translate captions to Vietnamese", async () => {
  await fresh();
  const result = await ask(page, "Translate the captions to Vietnamese.");
  report("translate", result, { export: await exportClip(page, "translate") });
  expect.soft(usedAny(result, ["translate_captions"]), "translated").toBe(true);
});

test("10. brand kit", async () => {
  await fresh();
  const result = await ask(page, "Apply my brand kit to this clip.");
  report("brand", result, { export: await exportClip(page, "brand") });
});

test("11. change of mind: Stop mid-work, then keep chatting", async () => {
  await fresh();
  const stopped = await ask(page, "/animate add diagrams for every point I make", { stopAfterMs: 20_000, waitForMedia: false });
  record("stop-then-chat (stopped)", { ...stopped });
  const result = await ask(page, "Never mind. Just tell me in one sentence what this clip is about.");
  report("stop-then-chat", result, { export: await exportClip(page, "stop-then-chat") });
});

test("12. undo", async () => {
  await fresh();
  await ask(page, "Add a title 'Day 56' at the start.");
  const result = await ask(page, "Undo that, I don't want the title.");
  report("undo", result, { export: await exportClip(page, "undo") });
});

test("13. faceless video from a prompt: /video on a New edit", async () => {
  await newEdit(page, "9:16");
  const result = await ask(page, "/video a 20-second video introducing a note-taking app for students: calm voice-over, light music, clean modern visuals. No people, no brand logos.");
  report("video-faceless", result, { export: await exportClip(page, "video-faceless") });
  expect.soft(result.generations.filter((g) => g.kind === "video" && g.status === "done").length, "shots made").toBeGreaterThan(0);
});

test("14. 5-second outro CTA: /video on a New edit", async () => {
  await newEdit(page, "9:16");
  const result = await ask(
    page,
    "/video 5-second vertical outro, cinematic and clean. A sleek laptop on a minimal desk at golden hour, its screen glowing with soft colorful blocks sliding into a neat row. Slow push-in, warm rim light. In the final second the glow blooms into a solid deep-navy background with calm empty space in the center. No people, no brand logos.\nVoiceover: \"Your videos, cut into clips. You approve, you post. OpenCMO.\"",
  );
  report("video-outro", result, { export: await exportClip(page, "video-outro") });
});

test("15. not enough credits", async () => {
  const { userId } = state();
  const { data: balance } = await admin().rpc("credit_balance", { p_user_id: userId });
  const take = Number(balance) - 3;
  await admin().from("credit_ledger").insert({ user_id: userId, delta: -take, reason: "Scenario: low balance" });
  try {
    await newEdit(page, "9:16");
    const box = page.getByLabel("Message the assistant");
    await box.fill("/video a 20-second video about morning routines");
    await box.press("Enter");
    const alert = page.getByRole("alert").or(page.getByTestId("assistant-turn").last());
    await expect(alert).toContainText(/credit/i, { timeout: 60_000 });
    record("low-credits", { problems: [], message: (await alert.innerText()).slice(0, 300) });
  } finally {
    await admin().from("credit_ledger").insert({ user_id: userId, delta: take, reason: "Scenario: restore balance" });
  }
});
