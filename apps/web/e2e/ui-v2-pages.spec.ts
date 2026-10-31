import { expect, test } from "@playwright/test";

import type { Project } from "../lib/clipping-types";
import { signIn, state } from "./helpers";

/**
 * Session C's v2 pages (ui-build plan U5–U8). They exist only in a build with NEXT_PUBLIC_OPENCMO_UI=v2,
 * so the default suite (flag off) skips this file and keeps testing today's pages.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 pages are built only with NEXT_PUBLIC_OPENCMO_UI=v2");

const PAGES: [string, string][] = [
  ["/app/analytics", "What worked, and what didn't."],
  ["/app/brain", "The plan, the orders, what it learned."],
  ["/app/library", "What your team knows about your business."],
  ["/app/research", "What works, with the link."],
  ["/app/writer", "Words, in your voice."],
  ["/app/studio", "Videos, shorts, slides."],
  ["/app/sales", "People who need what you built."],
  ["/app/settings", "Accounts, budget, and the off switch."],
];

for (const [path, heading] of PAGES) {
  test(`${path} renders on sample data without page scroll at 390 px`, async ({ page }) => {
    await signIn(page, state().users.a);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${path}?sample=1`);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("old project routes redirect to Studio", async ({ page }) => {
  await signIn(page, state().users.a);
  const id = "55555555-5555-4555-8555-555555555555";
  await page.goto("/app/projects");
  await expect(page).toHaveURL(/\/app\/studio$/);
  await page.goto(`/app/projects/${id}`);
  await expect(page).toHaveURL(new RegExp(`/app/studio\\?item=${id}$`));
  await page.goto(`/app/jobs/${id}`);
  await expect(page).toHaveURL(new RegExp(`/app/studio\\?item=${id}$`));
  await page.goto("/app/brand");
  await expect(page).toHaveURL(/\/app\/library\?tab=brand$/);
});

// Ported from projects-delete.spec.ts: Studio must keep the old page's delete guarantees.
const project: Project = {
  id: "55555555-5555-4555-8555-555555555555",
  source_name: "Disposable video",
  title: "Remove me",
  favorite: false,
  status: "done",
  stage: "done",
  duration: 90,
  clips_requested: 1,
  error: null,
  created_at: "2026-09-21T00:00:00.000Z",
  finished_at: "2026-09-21T00:01:00.000Z",
  attempt_started_at: "2026-09-21T00:00:00.000Z",
  has_transcript: false,
  settings: { aspect: "9:16", layout: "auto", captions: true },
  clips: [],
};

async function deleteFromMenu(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "More for Remove me" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("menuitem", { name: "Delete? Tap again" }).click();
}

test("Studio deletes an upload only after the second tap and the server's answer", async ({ page }) => {
  await signIn(page, state().users.a);
  let visible = true;
  await page.route("**/api/v1/projects?*", (route) => route.fulfill({ json: { items: visible ? [project] : [], next_cursor: null } }));
  await page.route(`**/api/v1/projects/${project.id}`, async (route) => {
    expect(route.request().method()).toBe("DELETE");
    visible = false;
    await route.fulfill({ json: { deleted: true } });
  });

  await page.goto("/app/studio?kind=upload");
  await expect(page.getByText("Remove me", { exact: true })).toBeVisible();
  await deleteFromMenu(page);
  await expect(page.getByText("Remove me", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Nothing here yet/)).toBeVisible();
});

test("a delayed search response cannot bring a deleted upload back", async ({ page }) => {
  await signIn(page, state().users.a);
  let releaseSearch!: () => void;
  let searchStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    searchStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route("**/api/v1/projects?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("q")) {
      searchStarted();
      await release;
    }
    await route.fulfill({ json: { items: [project], next_cursor: null } });
  });
  await page.route(`**/api/v1/projects/${project.id}`, (route) => route.fulfill({ json: { deleted: true } }));

  await page.goto("/app/studio?kind=upload");
  await expect(page.getByText("Remove me", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search videos, shorts, uploads" }).fill("Remove");
  await started;
  await deleteFromMenu(page);
  await expect(page.getByText("Remove me", { exact: true })).toHaveCount(0);
  const response = page.waitForResponse((r) => r.url().includes("/api/v1/projects?") && r.url().includes("q="));
  releaseSearch();
  await response;
  await expect(page.getByText("Nothing matches.")).toBeVisible();
  await expect(page.getByText("Remove me", { exact: true })).toHaveCount(0);
});

// Ported from isolation.spec.ts: B cannot open A's upload, by API or through Studio's drawer.
test("user B cannot open user A's upload in Studio", async ({ page }) => {
  const { users, url, service } = state();
  const created = await page.request.post(`${url}/rest/v1/jobs`, {
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json", prefer: "return=representation" },
    data: { user_id: users.a.id, source_url: `storage://${users.a.id}/isolation-v2.mp4`, status: "done", stage: "done", clips_requested: 1 },
  });
  const [job] = await created.json();

  await signIn(page, users.b);
  const api = await page.request.get(`/api/v1/projects/${job.id}`);
  expect(api.status()).toBe(404);

  await page.goto(`/app/studio?item=${job.id}`);
  await expect(page.getByText("This item is no longer in Studio.")).toBeVisible();
});
