import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * Realtime chỉ là đường nhanh, không phải nguồn sự thật duy nhất. Event có thể
 * xảy ra giữa response đầu tiên và lúc client subscribe; khi đó UI vẫn phải tự
 * đọc lại project thay vì hiện "running" mãi mãi.
 */
test("project tự cập nhật khi bỏ lỡ event Realtime kết thúc", async ({ page }) => {
  const { users, url, service } = state();
  const headers = {
    apikey: service,
    authorization: `Bearer ${service}`,
    "content-type": "application/json",
  };

  const created = await page.request.post(`${url}/rest/v1/jobs`, {
    headers: { ...headers, prefer: "return=representation" },
    data: {
      user_id: users.a.id,
      source_url: `storage://${users.a.id}/missed-realtime-event.mp4`,
      status: "running",
      stage: "render",
      clips_requested: 1,
    },
  });
  expect(created.ok()).toBeTruthy();
  const [job] = (await created.json()) as { id: string }[];

  await signIn(page, users.a);

  let firstRead = true;
  await page.route(`**/api/v1/projects/${job.id}`, async (route) => {
    if (!firstRead || route.request().method() !== "GET") {
      await route.continue();
      return;
    }

    firstRead = false;
    const staleRunningResponse = await route.fetch();
    const finished = await page.request.patch(`${url}/rest/v1/jobs?id=eq.${job.id}`, {
      headers,
      data: {
        status: "done",
        stage: "done",
        finished_at: new Date().toISOString(),
      },
    });
    expect(finished.ok()).toBeTruthy();
    await route.fulfill({ response: staleRunningResponse });
  });

  await page.goto(`/app/projects/${job.id}`);
  await expect(page.getByRole("heading", { name: "Preparing it for the editor…" })).toBeVisible();
  await expect(page.getByText("This video has no editable copy. Upload it again to edit it.")).toBeVisible({
    timeout: 8_000,
  });
});
