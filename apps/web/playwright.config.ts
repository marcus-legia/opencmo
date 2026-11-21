import { defineConfig, devices } from "@playwright/test";

/**
 * E2E trên trình duyệt thật.
 *
 *     cd /path/to/opencmo
 *     supabase start          # cần Docker; config nằm ở repository root
 *     cd apps/web
 *     npm run test:e2e
 *
 * `globalSetup` reset database, tạo hai user, dựng video fixture bằng ffmpeg và
 * bật worker fixture (`packages/engine/tests/e2e_worker.py`). Worker đó chỉ
 * chạy với Supabase loopback — xem đầu file của nó.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  // Một worker: cả bộ dùng chung một database local và một worker Python.
  workers: 1,
  fullyParallel: false,
  // Render thật bằng ffmpeg mất vài chục giây trên máy yếu.
  timeout: 180_000,
  expect: {
    timeout: 30_000,
    // Visual regression of the loop's screens (e2e/ui-v2-visual.spec.ts). One threshold for every shot: a shot that
    // needs more masks what changes instead. No animation, no caret.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide", scale: "css" },
  },
  // No OS or browser in the name: one set of baselines, taken on CI's runner (the spec's header says how).
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Chrome thật, không phải Chromium đi kèm Playwright: bản đó không decode
    // được H.264 ("Decoder config not supported"), nên master của editor —
    // luôn là H.264 vì engine cắt `-c copy` từ nguồn — hiện thành một ô màu
    // phẳng. `E2E_CHANNEL=chromium` chỉ để chạy các spec không đụng editor.
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_CHANNEL || "chrome",
        // Máy chỉ có Chromium khác bản Playwright của repo (sandbox): trỏ thẳng file chạy.
        ...(process.env.E2E_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_EXECUTABLE } } : {}),
      },
      testIgnore: /(mobile|ui-v2-visual)\.spec\.ts/,
    },
    // Visual regression on Playwright's own Chromium, pinned by @playwright/test in the lockfile: the runner's Chrome
    // moves with the runner image and would move every baseline with it. The loop's screens need no H.264.
    {
      name: "visual",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.E2E_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_EXECUTABLE } } : {}),
      },
      testMatch: /ui-v2-visual\.spec\.ts/,
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        ...(process.env.E2E_EXECUTABLE ? { launchOptions: { executablePath: process.env.E2E_EXECUTABLE } } : {}),
      },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    // CSP production cố ý không có `unsafe-eval`; `next dev` cần eval cho
    // React Refresh nên hydration sẽ chết trước khi test chạm được vào UI.
    command: "npm run build && npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: false,
    // A cold `next build` on a laptop can take longer than CI's; E2E_SERVER_TIMEOUT_MS raises the wait there.
    timeout: Number(process.env.E2E_SERVER_TIMEOUT_MS) || 180_000,
  },
});
