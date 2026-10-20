import { expect, test } from "@playwright/test";

import { SOURCE_VIDEO } from "./global-setup";
import { makeClipsInEditor, openClipsPanel, signIn, startClipsInEditor, state } from "./helpers";

/**
 * G1-c: cắt clip là một tính năng của editor. Rail không còn "New clips"; `/app/video` cũ dẫn
 * vào tab Clips; dán link phải tick "Is this your video?" (luật 3, server cũng chặn); upload →
 * clip → Open mở đúng clip đó như một bản sửa riêng.
 *
 * Manual picking only (plan item 1): Make clips needs a picked moment, the server refuses a clip
 * job without one, and each picked moment comes out as one clip of that length.
 */

test("tab Clips: link cần xác nhận chính chủ, upload ra clip mở được", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  page.on("pageerror", (error) => console.log(`[editor] ${error.message}`));
  await signIn(page, state().users.a);

  await page.goto("/app/projects");
  await expect(page.locator(".rail").getByRole("link", { name: "New clips" })).toHaveCount(0);
  await expect(page.locator(".rail").getByRole("link", { name: "My projects" })).toBeVisible();

  // Link cũ vẫn tới đúng chỗ.
  await page.goto("/app/video");
  await expect(page.getByTestId("clips-panel")).toBeVisible({ timeout: 120_000 });
  await expect(page).toHaveURL(/\/app\/editor\/[0-9a-f-]+$/);
  await expect(page.getByRole("tab", { name: "Clips" })).toHaveAttribute("aria-selected", "true");

  // Link: the button stays locked without the confirmation and without a moment; the API refuses both.
  const panel = page.getByTestId("clips-panel");
  await panel.getByTestId("clips-use-link").click();
  await panel.getByTestId("clips-url").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(panel.getByTestId("clips-submit")).toBeDisabled();
  await expect(panel.getByText("Is this your YouTube video?")).toBeVisible();
  await panel.getByTestId("clips-own").check();
  await expect(panel.getByTestId("clips-submit")).toBeDisabled();
  await expect(panel.getByTestId("clips-pick")).toBeEnabled();
  // Sửa link là phải xác nhận lại.
  await panel.getByTestId("clips-url").fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  await expect(panel.getByTestId("clips-own")).not.toBeChecked();
  await expect(panel.getByTestId("clips-submit")).toBeDisabled();
  const unconfirmed = await page.request.post("/api/v1/editor/clipping", {
    data: { source: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", segments: [{ start: 0, end: 10 }] },
  });
  expect(unconfirmed.status()).toBe(422);
  expect(await unconfirmed.text()).toContain("Confirm this is your own video");
  for (const body of [
    { source: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", ownership_confirmed: true, clips: 3 },
    { source: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", ownership_confirmed: true, segments: [] },
  ]) {
    const noMoments = await page.request.post("/api/v1/editor/clipping", { data: body });
    expect(noMoments.status()).toBe(422);
    expect(await noMoments.text()).toContain("Pick at least one moment to clip.");
  }

  for (const width of [1366, 1904]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`clips-link-${width}.png`) });
  }
  await panel.getByRole("button", { name: "Upload a file instead" }).click();
  await page.setViewportSize({ width: 1366, height: 900 });

  // Upload → clip → Open: clip mở như một bản sửa riêng (URL là clip của job vừa tạo).
  const before = page.url();
  const jobId = await makeClipsInEditor(page, SOURCE_VIDEO);
  expect(page.url()).not.toBe(before);
  const clipId = page.url().split("/").pop()!;
  const project = await (await page.request.get(`/api/v1/projects/${jobId}`)).json();
  expect(JSON.stringify(project)).toContain(clipId);
  await page.screenshot({ path: testInfo.outputPath("clips-opened-1366.png") });

  // Two moments on the upload: the job stores them and each comes out as one clip of that length.
  const twoJob = await startClipsInEditor(page, SOURCE_VIDEO, { moments: [[2, 8], [12, 20]] });
  await expect(page.locator(`[data-job="${twoJob}"]`).getByTestId("clips-open")).toHaveCount(2, { timeout: 150_000 });
  const two = (await (await page.request.get(`/api/v1/projects/${twoJob}`)).json()) as {
    segments: { start: number; end: number }[];
    clips: { moment: { start: number; end: number } }[];
  };
  expect(two.segments.map((s) => [Number(s.start), Number(s.end)])).toEqual([[2, 8], [12, 20]].map(([a, b]) => [expect.closeTo(a, 0), expect.closeTo(b, 0)]));
  expect(two.clips.map((clip) => clip.moment.end - clip.moment.start)).toEqual([expect.closeTo(6, 0), expect.closeTo(8, 0)]);
  await page.screenshot({ path: testInfo.outputPath("clips-two-moments-1366.png") });

  // Tab Clips của clip vừa mở vẫn thấy job (danh sách theo tài khoản, không theo bản sửa).
  await openClipsPanel(page);
  await expect(page.locator(`[data-job="${jobId}"]`).getByTestId("clips-open").first()).toBeVisible();
  for (const width of [1366, 1904]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`clips-jobs-${width}.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 900 });

  // A4: "Add explainer" copies a request for the user's Claude (MCP) naming the clip.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const finished = page.locator(`[data-job="${jobId}"]`);
  await finished.getByTestId("clips-explainer").first().click();
  await expect(page.getByTestId("clips-explainer-hint")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`clip_id ${clipId}`);

  // A4: "Add voiceover" opens that clip's edit with Generate on its Voiceover tab.
  const here = page.url();
  await finished.getByTestId("clips-voiceover").first().click();
  await page.waitForURL((url) => url.href !== here && new RegExp(`/app/editor/${clipId}$`).test(url.pathname), { timeout: 60_000 });
  await expect(page.getByTestId("generate-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("generate-kind-voiceover")).toHaveAttribute("aria-pressed", "true");
  await expect(page).not.toHaveURL(/generate=/);
  await page.screenshot({ path: testInfo.outputPath("clips-add-voiceover-1366.png") });
});
