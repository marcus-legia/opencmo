import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { signIn, state } from "./helpers";
import { seedCoreDraft } from "./ui-v2-seed";

/**
 * The daily core draft on screen (core-drafts follow-ups Task 1): the planner the founder sets, the one Feed card for
 * three platforms, the three schedule cards its approval gives, and the Feed's way to the planner. The SQL of the same
 * flow is `supabase/tests/312_core_draft_flow.test.sql`. v2 build only: `npm run test:e2e:v2`.
 */
test.skip(
  process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2",
  "v2 UI only: run with npm run test:e2e:v2",
);

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

test("the planner shows seven platforms, a logo each, and saves a change", async ({
  page,
}) => {
  const { user } = await seedCoreDraft();
  await signIn(page, user);
  await page.goto("/app/schedule#posting-plan");
  const planner = page.getByTestId("posting-plan");
  await expect(planner).toBeVisible();
  const rows = planner.locator(".pp-row");
  await expect(rows).toHaveCount(7);
  for (let i = 0; i < 7; i++)
    await expect(rows.nth(i).locator(".pl-tile svg")).toHaveCount(1);
  await expect(planner.getByTestId("posting-plan-line")).toBeVisible();
  await expect(planner).toContainText("X, Threads and LinkedIn");

  await planner
    .getByRole("button", { name: "More posts a day on LinkedIn" })
    .click();
  await expect(planner.getByLabel("LinkedIn: posts a day")).toHaveText(
    "2 a day",
  );
  await expect
    .poll(
      async () =>
        (
          (
            await admin()
              .from("profiles")
              .select("posting_plan")
              .eq("id", user.id)
              .single()
          ).data?.posting_plan as { text: { linkedin: number } }
        ).text.linkedin,
    )
    .toBe(2);
});

test("one Feed card for three platforms; approving it gives the three schedule cards", async ({
  page,
}) => {
  const db = admin();
  const { user, itemId, cardId } = await seedCoreDraft();
  await signIn(page, user);
  await page.goto("/app");
  const row = page.locator(
    `[data-testid="feed-row"][data-card-id="${cardId}"]`,
  );
  await expect(row).toContainText("Post for 3 platforms");
  await row.getByRole("button", { name: "Review" }).click();
  const targets = row.getByTestId("post-targets");
  await expect(targets).toContainText("One post, goes out on");
  await expect(targets.locator(".v2-card-goes li")).toHaveText([
    "X",
    "Threads",
    "LinkedIn",
  ]);

  await row
    .getByTestId("approval-card")
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await db
            .from("content_items")
            .select("status")
            .eq("id", itemId)
            .single()
        ).data?.status,
    )
    .toBe("approved");

  // X rides on the post card's time (its schedule approval is the post card's); Threads and LinkedIn ask on a card each.
  const deliverable = (
    await db
      .from("deliverables")
      .select("id")
      .eq("ref_kind", "content_item")
      .eq("ref_id", itemId)
      .single()
  ).data!.id;
  const schedule = async () => {
    const slots =
      (
        await db
          .from("schedule_slots")
          .select("id, platform, mode, status")
          .eq("deliverable_id", deliverable)
      ).data ?? [];
    const cards =
      (
        await db
          .from("approvals")
          .select("ref_id, status")
          .eq("ref_kind", "schedule_slot")
          .in(
            "ref_id",
            slots.length
              ? slots.map((s) => s.id)
              : ["00000000-0000-0000-0000-000000000000"],
          )
      ).data ?? [];
    return slots
      .map(
        (s) =>
          `${s.platform} ${s.mode} ${cards.find((c) => c.ref_id === s.id)?.status ?? "no card"}`,
      )
      .sort();
  };
  await expect
    .poll(schedule)
    .toEqual([
      "linkedin intent waiting",
      "threads publish waiting",
      "x publish approved",
    ]);

  // The two cards still to decide reach the Feed.
  await page.reload();
  const slotCards =
    (
      await db
        .from("approvals")
        .select("id")
        .eq("ref_kind", "schedule_slot")
        .eq("status", "waiting")
        .eq("user_id", user.id)
    ).data ?? [];
  expect(slotCards).toHaveLength(2);
  for (const c of slotCards)
    await expect(
      page.locator(`[data-testid="feed-row"][data-card-id="${c.id}"]`),
    ).toBeVisible();
});

test("the icon next to Refresh opens the calendar at the planner", async ({
  page,
}) => {
  const { user } = await seedCoreDraft();
  await signIn(page, user);
  await page.goto("/app");
  await page.getByTestId("feed-posting-plan").click();
  await expect(page).toHaveURL(/\/app\/schedule#posting-plan$/);
  await expect(page.getByTestId("posting-plan")).toBeInViewport();
});
