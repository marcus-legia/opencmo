import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Visual regression of the CMO loop's v2 screens (web hardening round 4, session C): setup → today → Writer → a post
 * card waiting for approval → Schedule (the slideshow page left in wave 4b), at 1440 × 900 and 390 × 844 in light, plus today in dark.
 * A layout that moves fails the nightly `full-v2` run with an expected/actual/diff image in the job's artifact.
 *
 * Baselines live in `ui-v2-visual.spec.ts-snapshots/` without the OS in their name (`playwright.config.ts`), and come
 * from CI's runner, because its fonts and Chrome decide the pixels. When a screen changes on purpose:
 *
 *   1. Actions → E2E → Run workflow on the branch, with `update_snapshots` ticked. That job runs only this spec with
 *      `--update-snapshots` and uploads the images as the artifact `e2e-visual-snapshots`.
 *   2. Download it, look at every image at full size (a baseline of a broken screen is worse than none), copy the files
 *      into `apps/web/e2e/ui-v2-visual.spec.ts-snapshots/`, commit.
 *   3. Run the workflow again without the box: `full-v2` passes.
 *
 * Locally (`npm run test:e2e:visual`) a different font stack fails every shot; that proves nothing either way.
 *
 * What keeps a shot stable: screens read their fixtures (`?sample=1`), a founder of this spec's own (other specs change
 * user A's accounts and cards), the browser clock frozen in the fixtures' week, no animation or caret, fonts loaded, and
 * a mask on anything that still changes from run to run.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:visual");
// Times the screens format in the browser follow its zone and locale, not the runner's.
test.use({ timezoneId: "UTC", locale: "en-US" });

/** The fixtures' week (lib/screens/fixtures: Mon 2026-10-26 to Sun 2026-11-01). */
const NOW = new Date("2026-10-28T10:00:00Z");

/**
 * Two founders of this spec's own, so other specs' accounts and cards never show: `ready` is past Setup, `new` has no
 * document yet (Setup sends a founder who has one on to the feed). The order runner is paused for both.
 */
const founders = {} as Record<"ready" | "new", E2EUser>;

test.beforeAll(async () => {
  const { url, service } = state();
  const db = createClient(url, service, { auth: { persistSession: false } });
  for (const label of ["ready", "new"] as const) {
    // A fresh address per worker, so a second run on the same stack (`--repeat-each`) never collides; the avatar shows
    // the first letter only, which stays "E".
    const email = `e2e-visual-${label}-${randomUUID()}@test.local`;
    const password = `pw-${randomUUID()}`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`Could not create the ${label} founder: ${created.error.message}`);
    const id = created.data.user!.id;
    founders[label] = { email, password, id };
    const profile = await db
      .from("profiles")
      .update({ plan: "creator", credit_balance: 100, timezone: "UTC", cmo_paused_at: NOW.toISOString() })
      .eq("id", id);
    if (profile.error) throw new Error(`Could not seed the profile: ${profile.error.message}`);
    if (label === "new") continue;
    // The same document `ui-v2-seed.ts` gives users A and B: enough for /app to skip Setup.
    const doc = await db.from("marketing_documents").insert({ user_id: id, ...ONBOARDING_DOCUMENT });
    if (doc.error) throw new Error(`Could not seed a document: ${doc.error.message}`);
  }
});

type Shot = { name: string; path: string; ready: string; founder?: "new"; open?: (page: Page) => Promise<void> };

/** The loop in order (CLAUDE.md "Strategy"). */
const LOOP: Shot[] = [
  { name: "setup", path: "/app/setup", ready: "v2-setup", founder: "new" },
  { name: "today", path: "/app?sample=1", ready: "v2-dashboard" },
  { name: "writer", path: "/app/writer?sample=1", ready: "v2-writer" },
  { name: "post-card", path: "/app/inbox/card-post", ready: "inbox-card-page" },
  { name: "schedule", path: "/app/schedule?sample=1", ready: "v2-schedule" },
];

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
];

async function shoot(page: Page, shot: Shot, file: string): Promise<void> {
  await signIn(page, founders[shot.founder ?? "ready"]);
  await page.clock.setFixedTime(NOW);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(shot.path);
  // Visible only: while the page streams, React keeps the next Suspense segment in a hidden copy (ui-v2-look.spec.ts).
  await expect(page.getByTestId(shot.ready).filter({ visible: true })).toBeVisible();
  // Still on the shot's own screen: a redirect (Setup → feed) would otherwise be shot mid-way.
  expect(new URL(page.url()).pathname).toBe(new URL(shot.path, "http://x").pathname);
  // Screens read their data client-side; `main` only, as in the look check (the chat panel beside today keeps a busy
  // element of its own while it waits for a conversation that never comes in a test).
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  await shot.open?.(page);
  // Above 900 px the shell's three columns scroll on their own (styles/today-app.css), so the document is one window
  // tall and a full-page shot would stop at the fold. Unrolled, every row of the screen is compared.
  await page.addStyleTag({ content: ".pg-main .cols { height: auto !important; } .pg-main .cols > * { overflow: visible !important; max-height: none !important; }" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page).toHaveScreenshot(file, {
    fullPage: true,
    mask: [
      // Toasts and the Next dev/route announcer come and go on their own time.
      page.locator("[data-sonner-toaster], [role='status'][aria-live]"),
      // Anything the app marks as changing run to run (relative times, avatars, ids).
      page.locator("time, [data-visual-mask]"),
    ],
  });
}

for (const shot of LOOP) {
  for (const vp of VIEWPORTS) {
    test(`${shot.name} at ${vp.label}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await shoot(page, shot, `${shot.name}-${vp.label}.png`);
    });
  }
}

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });
  test("today at 1440, dark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, LOOP[1], "today-1440-dark.png");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
