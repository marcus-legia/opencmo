import { defineConfig, devices } from "@playwright/test";

/**
 * User scenarios against the local dev stack with REAL models (Claude, fal, Veo, ElevenLabs).
 * Every run spends real money, so this is never part of CI.
 *
 *     npm run dev                      # repo root: local Supabase + Next + worker
 *     cd apps/web && npm run test:scenarios
 *     npm run test:scenarios -- -g "background"   # one scenario
 *
 * Results, exported files and frames land in .scenarios-out/ at the repo root (gitignored), outside
 * apps/web: `next dev` reloads the editor whenever files change under it.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.scenario\.ts$/,
  globalSetup: "./setup.ts",
  workers: 1,
  fullyParallel: false,
  // Real AI video takes minutes per shot.
  timeout: 30 * 60_000,
  expect: { timeout: 60_000 },
  reporter: [["list"], ["json", { outputFile: "../../../.scenarios-out/playwright.json" }]],
  outputDir: "../../../.scenarios-out/artifacts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    // A tab with unsaved edits asks before leaving; without a limit, a declined dialog hangs goto forever.
    navigationTimeout: 120_000,
    screenshot: "only-on-failure",
    viewport: { width: 1600, height: 900 },
  },
  projects: [
    {
      name: "scenarios",
      // Real Chrome: the bundled Chromium cannot decode H.264, so the editor would show no video.
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1600, height: 900 } },
    },
  ],
});
