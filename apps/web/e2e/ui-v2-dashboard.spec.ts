import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * The v2 feed (Main.dc.html; U3, U4). Runs only in a build with NEXT_PUBLIC_OPENCMO_UI=v2: `npm run test:e2e:v2`.
 * One test on the fixture (`?sample=1`), one on real `approvals` rows decided through `approval_decide`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

/** The feed's rows that stand for an approval card (Main.dc.html), and a row's card opened in place. */
const cardRows = (page: Page) => page.getByTestId("approval-queue").locator('[data-testid="feed-row"][data-card-id]');
async function openRow(row: Locator): Promise<Locator> {
  const card = row.getByTestId("approval-card");
  if (!(await card.isVisible())) {
    const review = row.getByRole("button", { name: "Review" });
    await (await review.isVisible() ? review : row.locator("button.row")).click();
  }
  await expect(card).toBeVisible();
  return card;
}

test("on the fixture, approving drops every count and empties the feed", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app?sample=1");

  const rows = cardRows(page);
  const waiting = page.getByTestId("flow-waiting");
  const feed = page.getByTestId("v2-dashboard");
  await expect(rows).toHaveCount(5);
  await expect(waiting).toContainText("5");
  await expect(feed).toContainText("5 items need your attention today.");
  // The first row is the inverted one, opened on its card (Main.dc.html).
  await expect(rows.first()).toHaveClass(/\binv\b/);
  await expect(rows.first().getByTestId("approval-card")).toBeVisible();

  // The X post card itself; after 1.2 a post you post yourself reads "Approve for this time", others "Approve".
  const post = await openRow(page.getByTestId("approval-queue").locator('[data-card-id="card-post"]'));
  await post.getByRole("button", { name: /^Approve( for this time)?$/ }).click();
  await expect(rows).toHaveCount(4);
  await expect(waiting).toContainText("4");
  await expect(feed).toContainText("4 items need your attention today.");

  // Dismissing asks for an optional reason before the card leaves.
  const reply = await openRow(page.getByTestId("approval-queue").locator('[data-card-id="card-reply"]'));
  await reply.getByRole("button", { name: "Dismiss" }).click();
  await reply.getByLabel(/Why\?/).fill("Not my audience");
  await reply.locator(".v2-card-decline").getByRole("button", { name: "Dismiss" }).click();
  await expect(rows).toHaveCount(3);

  while ((await rows.count()) > 0) {
    const card = await openRow(rows.first());
    await card.locator(".v2-button.is-primary").first().click();
    await expect(card).toHaveCount(0);
  }
  await expect(feed).toContainText("Nothing waits on you.");
  await expect(waiting).toContainText("0");
});

test("on live rows, cards decide through approval_decide, a changed card is refused, Realtime refreshes", async ({ page }) => {
  const { url, service, users } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const user = users.b;
  const post = async (text: string) => {
    const { data, error } = await admin
      .from("content_items")
      .insert({ user_id: user.id, department: "post", platform: "x", day: new Date().toISOString().slice(0, 10), idea: text, status: "in_review", body: { text, alternates: [] } })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  const first = await post("Live card one: cut a video by deleting words.");
  const second = await post("Live card two: ask for B-roll on the line.");

  try {
    await signIn(page, user);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/app");
    const queue = page.getByTestId("approval-queue");
    const rows = cardRows(page);
    await expect(queue.getByText("Sample data")).toHaveCount(0);
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("flow-waiting")).toContainText("2");

    // Approve the first (open) card: the server decides it and the post moves on.
    // After 1.2 a post you post yourself reads "Approve for this time"; others still read "Approve".
    const one = await openRow(rows.filter({ hasText: "Live card one" }));
    await one.getByRole("button", { name: /^Approve( for this time)?$/ }).click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId("v2-dashboard")).toContainText("1 item needs your attention today.");
    await expect.poll(async () => (await admin.from("content_items").select("status").eq("id", first).single()).data?.status).toBe("approved");
    await expect.poll(async () => (await admin.from("approvals").select("status, decided_via").eq("ref_id", first).eq("status", "approved").maybeSingle()).data?.decided_via).toBe("app");

    // The second card changes after the page read it. The old hash is refused by the route the cards use, and
    // Realtime brings the new version to the screen without a reload.
    const { data: stale } = await admin.from("approvals").select("id, content_hash").eq("ref_id", second).eq("status", "waiting").single();
    await admin.from("content_items").update({ body: { text: "Live card two, redrafted.", alternates: [] } }).eq("id", second);
    const refused = await page.request.post(`/api/v1/approvals/${stale!.id}`, { data: { action: "approve", contentHash: stale!.content_hash } });
    expect(refused.ok()).toBeFalsy();
    expect(JSON.stringify(await refused.json())).toMatch(/already decided|changed/);
    await expect(queue).toContainText("Live card two, redrafted.");
    expect((await admin.from("content_items").select("status").eq("id", second).single()).data?.status).toBe("in_review");

    // One card on its own page reads the same row.
    const { data: card } = await admin.from("approvals").select("id").eq("ref_id", second).eq("status", "waiting").single();
    await page.goto(`/app/inbox/${card!.id}`);
    await expect(page.getByTestId("inbox-card-page").getByTestId("approval-card")).toContainText("Live card two, redrafted.");
  } finally {
    await admin.from("content_items").delete().in("id", [first, second]);
  }
});

test("the phone shows the feed and the agents without sideways scroll, and one card per page", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app?sample=1");

  await expect(page.getByRole("region", { name: "Your team" })).toBeVisible();
  await expect(cardRows(page)).toHaveCount(5);
  await expect(page.getByTestId("flow-waiting")).toContainText("5");
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);

  await page.goto("/app/inbox/card-reply");
  await expect(page.getByTestId("inbox-card-page").getByTestId("approval-card")).toContainText("r/SaaS");
  await page.goto("/app/inbox/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("This card is no longer here.")).toBeVisible();
});
