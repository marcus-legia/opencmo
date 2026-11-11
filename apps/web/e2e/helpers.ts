import { expect, type Locator, type Page } from "@playwright/test";

import { readState, type E2EUser } from "./global-setup";

export const state = () => readState();

/**
 * Đăng nhập bằng mật khẩu qua trang `/login`? Không — trang đó chỉ có Google.
 * Ở đây lấy phiên bằng mật khẩu qua API Auth (chỉ Supabase local bật email) rồi
 * đặt cookie cho `@supabase/ssr`; `login.spec.ts` kiểm nút Google.
 */
export async function signIn(page: Page, user: E2EUser): Promise<void> {
  const { url, anon } = state();
  const ref = new URL(url).hostname.split(".")[0] || "localhost";
  const response = await page.request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "content-type": "application/json" },
    data: { email: user.email, password: user.password },
  });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();

  await page.context().addCookies([
    {
      name: `sb-${ref}-auth-token`,
      value: `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64")}`,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

/** Waits for an upload to finish processing on its project page. The fixture worker renders for real. */
export async function waitForReady(page: Page): Promise<void> {
  await expect(page.getByTestId("project-open-editor")).toBeVisible({ timeout: 150_000 });
}

/** Mở panel Assistant (cột riêng theo bố cục Palmier, mặc định ẩn ở màn hẹp). */
export async function showAssistant(page: Page): Promise<void> {
  const toggle = page.getByTestId("panel-agent");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(page.getByLabel("Message the assistant")).toBeVisible();
}

/** Opens the editor's Upload tab: the one way a project starts. */
export async function openUploadPanel(page: Page): Promise<void> {
  await page.goto("/app/editor?panel=upload");
  // The first visit to the editor route on the dev server may compile: wait generously.
  await expect(page.getByTestId("upload-panel")).toBeVisible({ timeout: 120_000 });
  await expect(page).not.toHaveURL(/panel=upload/);
}

/** Uploads a video from the Upload tab and starts its job. Returns the job (project) id. */
export async function startUpload(
  page: Page,
  file: string,
  options: { aspect?: "9:16" | "1:1" | "16:9" } = {},
): Promise<string> {
  await openUploadPanel(page);
  await page.getByTestId("upload-file").setInputFiles(file);
  if (options.aspect) await page.getByTestId("upload-panel").getByRole("radio", { name: options.aspect }).check({ force: true });
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/editor/upload") && response.request().method() === "POST",
    { timeout: 120_000 },
  );
  await page.getByTestId("upload-submit").click();
  const response = await created;
  expect(response.ok(), await response.text()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

/** Upload → wait for processing → Open: the editor opens the upload's one editable clip. */
export async function uploadToEditor(page: Page, file: string): Promise<string> {
  const jobId = await startUpload(page, file);
  const job = page.locator(`[data-job="${jobId}"]`);
  await expect(job.getByTestId("upload-open")).toBeVisible({ timeout: 150_000 });
  // Standing in another edit: wait for the URL to CHANGE, not just to match /app/editor/<id>.
  const current = page.url();
  await job.getByTestId("upload-open").click();
  await page.waitForURL((url) => url.href !== current && /\/app\/editor\/[0-9a-f-]+$/.test(url.pathname), { timeout: 60_000 });
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Loading media…")).toHaveCount(0, { timeout: 120_000 });
  return jobId;
}

/** The project page of a job (My projects), once it is ready. */
export async function openProject(page: Page, jobId: string): Promise<void> {
  await page.goto(`/app/projects/${jobId}`);
  await waitForReady(page);
}

/**
 * The page's scroll width and, when it is wider than the viewport, the deepest elements that stick out past the right
 * edge: a failing "no sideways scroll" check then names what to fix instead of only a number.
 */
export async function sidewaysOverflow(page: Page): Promise<{ width: number; culprits: string[] }> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth;
    const culprits: string[] = [];
    if (root.scrollWidth > limit) {
      for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
        const box = el.getBoundingClientRect();
        if (box.right <= limit + 1 || box.width === 0) continue;
        if (Array.from(el.children).some((child) => child.getBoundingClientRect().right > limit + 1)) continue;
        const name = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
        culprits.push(`${name} → ${Math.round(box.right)}px`);
        if (culprits.length >= 8) break;
      }
    }
    return { width: root.scrollWidth, culprits };
  });
}

/**
 * The feed (Main.dc.html) shows a row per waiting card; only the open row holds the real card. Opens the first row that
 * matches `text` (its "Review" button, or the row itself for the inverted first row) and returns the card.
 */
export async function openFeedCard(page: Page, text: string | RegExp): Promise<Locator> {
  const row = page.getByTestId("approval-queue").locator('[data-testid="feed-row"][data-card-id]').filter({ hasText: text }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const card = row.getByTestId("approval-card");
  if (!(await card.isVisible())) {
    const review = row.getByRole("button", { name: "Review" });
    await ((await review.isVisible()) ? review : row.locator("button.row")).click();
  }
  await expect(card).toBeVisible();
  return card;
}
