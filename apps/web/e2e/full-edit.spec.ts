import { expect, test } from "@playwright/test";

import { SOURCE_VIDEO } from "./global-setup";
import { signIn, state, uploadToEditor } from "./helpers";

/**
 * An upload opens WHOLE in the editor: the worker remuxes it into the master and transcribes it,
 * and the timeline covers the full video, not a window of it.
 */
test("an upload opens the whole file in the editor", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  page.on("pageerror", (error) => console.log(`[editor] ${error.message}`));
  await signIn(page, state().users.a);
  await uploadToEditor(page, SOURCE_VIDEO);
  // The fixture is 30 s long.
  await expect(page.getByTestId("playhead-time")).toContainText(/\/ 0:(29|30)\./, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByTestId("transcript-word").first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: testInfo.outputPath("full-edit.png") });
});
