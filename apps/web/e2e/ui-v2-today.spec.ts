import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * Today (CMO review 3, 1.1): the feed's first rows (Main.dc.html), read from real rows. Approving the top row in place moves
 * "N of M done today"; a platform quiet for days comes first. At 1280 px and 390 px, with a screenshot of each to look
 * at (`test-results/today-*.png`).
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function seed(userId: string, texts: string[]): Promise<string[]> {
  const db = admin();
  const ids: string[] = [];
  for (const text of texts) {
    const { data, error } = await db
      .from("content_items")
      .insert({ user_id: userId, department: "post", platform: "x", day: new Date().toISOString().slice(0, 10), idea: text, status: "in_review", body: { text, alternates: [] } })
      .select("id")
      .single();
    expect(error).toBeNull();
    ids.push(data!.id as string);
  }
  return ids;
}

async function cleanup(userId: string, ids: string[]): Promise<void> {
  const db = admin();
  await db.from("approvals").delete().eq("user_id", userId).in("ref_id", ids);
  await db.from("content_items").delete().in("id", ids);
}

async function approveTopRow(page: Page, width: number): Promise<void> {
  // The feed (Main.dc.html): Today's rows first, the first one inverted and opened on its card.
  const feed = page.getByTestId("approval-queue");
  const rows = feed.getByTestId("feed-row");
  const count = page.getByRole("main").getByTestId("today-count");
  await expect(feed.getByText("Sample data")).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect(count).toHaveText("0 of 2 done");
  await page.screenshot({ path: `test-results/today-${width}.png`, fullPage: false });
  // The theme follows the system by default and is read when the page loads: the same view in dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(count).toHaveText("0 of 2 done");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `test-results/today-${width}-dark.png`, fullPage: false });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(rows).toHaveCount(2);

  const card = rows.first().getByTestId("approval-card");
  await expect(card).toBeVisible();
  // A post card approves its words and its time at once (A's 1.2): "Approve for this time", or "Approve" without one.
  await card.getByRole("button", { name: /^Approve( for this time)?$/ }).click();
  await expect(count).toHaveText("1 of 2 done");
  await expect(rows).toHaveCount(1);
  await page.screenshot({ path: `test-results/today-${width}-after.png`, fullPage: false });
}

for (const width of [1280, 390]) {
  test(`at ${width} px, approving the top row moves the count`, async ({ page }) => {
    const user = state().users.b;
    const db = admin();
    // A paid founder: approving needs a plan once the paywall is on (plan §3.1).
    await db.from("profiles").update({ plan: "starter" }).eq("id", user.id);
    // Nothing else waits, so the two seeded posts are the day; cards other specs decided today for this shared user
    // move to yesterday, so "done today" counts only this test's decision.
    await db.from("approvals").update({ status: "cancelled" }).eq("user_id", user.id).eq("status", "waiting");
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await db.from("approvals").update({ decided_at: yesterday }).eq("user_id", user.id).gte("decided_at", new Date(Date.now() - 86_400_000).toISOString());
    const ids = await seed(user.id, [`Today one at ${width}: cut a video by deleting words.`, `Today two at ${width}: B-roll on the line.`]);
    try {
      await signIn(page, user);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/app");
      await approveTopRow(page, width);
      await expect.poll(async () => (await db.from("content_items").select("status").eq("id", ids[0]!).single()).data?.status).toBe("approved");
    } finally {
      await cleanup(user.id, ids);
    }
  });
}

test("a platform quiet for days comes first and asks the CMO for a post", async ({ page }) => {
  const user = state().users.b;
  const db = admin();
  await db.from("approvals").update({ status: "cancelled" }).eq("user_id", user.id).eq("status", "waiting");
  const day = new Date(Date.now() - 9 * 86_400_000);
  const { data: old, error } = await db
    .from("content_items")
    .insert({ user_id: user.id, department: "post", platform: "LinkedIn", day: day.toISOString().slice(0, 10), idea: "An old LinkedIn post", status: "published", published_at: day.toISOString(), body: { text: "An old LinkedIn post" } })
    .select("id")
    .single();
  expect(error).toBeNull();
  try {
    await signIn(page, user);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/app");
    const first = page.getByTestId("approval-queue").getByTestId("feed-row").first();
    await expect(first).toContainText("LinkedIn: nothing posted for 9 days");
    await first.getByRole("button", { name: "Ask your CMO for a post" }).click();
    await expect(page.locator("textarea:focus")).toHaveValue("Write me a post for LinkedIn for today.");
  } finally {
    await db.from("content_items").delete().eq("id", old!.id);
  }
});
