import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Post sources (wave 3, C2): a draft written from the Library says what it is based on in the Post list, and the open
 * draft lists each conversation's summary and where it was said, never its title. Seeded as `post_draft` stores it.
 * Screenshot: `test-results/post-sources-1440.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

test("a draft from the Library: Based on N conversations in the list, each source's summary when open", async ({ page }) => {
  test.setTimeout(120_000);
  const { url, service } = state();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const email = `e2e-sources-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  expect((await db.from("marketing_documents").insert({ user_id: userId, ...ONBOARDING_DOCUMENT })).error).toBeNull();

  const sources = [
    { opportunityId: randomUUID(), summary: "Chases three clients a month by hand", platform: "reddit", community: "freelance" },
    { opportunityId: randomUUID(), summary: "Tracks invoices in a spreadsheet that breaks", platform: "hn", community: "Ask HN" },
  ];
  const itemId = randomUUID();
  const inserted = await db.from("content_items").insert({
    id: itemId,
    user_id: userId,
    department: "post",
    platform: "X",
    day: new Date().toISOString().slice(0, 10),
    idea: "Late invoices",
    status: "in_review",
    body: { text: "Most late invoices are paid after the third reminder, not the first.", alternates: [], sources },
  });
  expect(inserted.error).toBeNull();

  await signIn(page, { email, password, id: userId });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/writer");
  const row = page.getByTestId("writer-row").filter({ hasText: "Most late invoices" });
  // The row shows the sources' logos and a count; the full line stays its tooltip and its screen-reader text.
  await expect(row.getByTestId("writer-based-on")).toHaveAttribute("title", "Based on 2 conversations · Reddit, Hacker News");
  await expect(row.getByTestId("writer-based-on")).toContainText("2 sources");

  // The first waiting draft opens on its own; open it only if it is closed.
  const toggle = row.getByRole("button").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const list = row.getByTestId("writer-sources");
  await expect(list).toBeVisible();
  await expect(list.getByTestId("writer-source")).toHaveCount(2);
  await expect(list).toContainText("Chases three clients a month by hand");
  await expect(list).toContainText("r/freelance");
  await expect(list).toContainText("Hacker News · Ask HN");
  await expect(list.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/app/library");
  await page.screenshot({ path: "test-results/post-sources-1440.png" });

  // At phone width the line still fits the row.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.getByTestId("writer-based-on")).toBeVisible();
  await page.screenshot({ path: "test-results/post-sources-390.png" });
});
