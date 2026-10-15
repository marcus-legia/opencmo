import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { SOURCE_VIDEO } from "./global-setup";
import { makeClipsInEditor, showAssistant, signIn, state } from "./helpers";

/**
 * E4-e: phụ đề cho một video thư viện (worker e2e: ffmpeg thật, Groq giả) → lớp captions
 * mới, credit trừ đúng 1; dịch (AI giả) → lớp thứ hai; bật Censor.
 */

async function openEditor(page: Page) {
  await makeClipsInEditor(page, SOURCE_VIDEO);
}

const balance = async (page: Page) => ((await (await page.request.get("/api/v1/account")).json()) as { credits: number }).credits;

test("library video captions, translation and censor", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  page.on("pageerror", (error) => console.log(`[editor] ${error.message}`));
  await signIn(page, state().users.a);
  await openEditor(page);

  // B-roll có tiếng, 20 s → 1 credit.
  const file = testInfo.outputPath("talking.mp4");
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=15:d=20", "-f", "lavfi", "-i", "sine=f=330:d=20",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
  ]);
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByTestId("import-input").setInputFiles(file);
  await expect(page.getByTestId("asset-talking.mp4")).toBeVisible();
  await page.getByTestId("asset-talking.mp4").locator(".ed2-lib-icon").dblclick();

  // Video thư viện là `rect` tô bằng paint video: thanh `ed2-bar-broll`, không phải thanh video của clip.
  await page.locator(".ed2-bar-broll").first().click();
  const generate = page.getByTestId("generate-captions");
  await expect(generate).toHaveText(/Generate captions \(1 credit\)/);
  await expect(generate).toBeEnabled({ timeout: 120_000 });
  const before = await balance(page);
  await generate.click();
  await expect(page.getByText("Captions · talking.mp4").first()).toBeVisible({ timeout: 120_000 });
  await expect.poll(() => balance(page), { timeout: 30_000 }).toBe(before - 1);
  await page.screenshot({ path: testInfo.outputPath("01-captions.png") });

  // Select the new captions layer by its row label.
  await page.getByText("Captions · talking.mp4").first().click();
  const originalEnd = await page.getByTestId("ins-end").locator("input").inputValue();
  await page.getByTestId("ins-caption-censor").check();
  await page.getByTestId("translate-captions").selectOption("Spanish");
  await expect(page.getByText("Captions · Spanish").first()).toBeVisible({ timeout: 60_000 });
  // The translation keeps the original layer's time window, not the 16 s default of a new layer.
  await page.getByText("Captions · Spanish").first().click();
  await expect(page.getByTestId("ins-end").locator("input")).toHaveValue(originalEnd);
  expect(originalEnd).not.toBe("16");
  await page.getByTestId("zoom-fit").click();
  await page.screenshot({ path: testInfo.outputPath("02-translated.png") });

  // F2: agent làm được cùng việc qua thẻ duyệt có giá — tạo phụ đề cho B-roll.
  const beforeAgent = await balance(page);
  await showAssistant(page);
  await page.getByLabel("Message the assistant").fill("caption the b-roll");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-approval")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("assistant-approval")).toContainText("1 credit");
  await page.screenshot({ path: testInfo.outputPath("03-agent-approval.png") });
  await page.getByTestId("assistant-approve").click();
  await expect(page.getByTestId("assistant-reply").last()).toContainText("new captions layer", { timeout: 180_000 });
  const clipId = page.url().split("/").pop()!;
  await expect
    .poll(async () => (JSON.stringify((await (await page.request.get(`/api/v1/editor/document?clip_id=${clipId}`)).json()).document).match(/"name":"Captions · talking\.mp4"/g) ?? []).length)
    .toBe(2);
  // Lượt Assistant có phí riêng: kiểm đúng dòng sổ cái của phụ đề (3 lượt: nút, dịch là dòng khác, agent).
  const { url, service } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: rows } = await admin.from("credit_ledger").select("delta").eq("user_id", state().users.a.id).eq("reason", "Captions");
  expect((rows ?? []).map((row) => row.delta)).toEqual([-1, -1]);
  expect(await balance(page)).toBeLessThan(beforeAgent);
});
