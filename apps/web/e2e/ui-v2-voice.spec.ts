import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { E2EUser } from "./global-setup";
import { signIn, state } from "./helpers";

/**
 * cmo-review-3 group 2, on live rows (`OPENCMO_AGENT_FAKE=1`: `distill_ratings` writes one rule per reason picked on a
 * thumbs down): rate three drafts on the sheet, accept two rules, see them in Library → Voice; edit a rule, Undo,
 * and it reads as before. v2 build only: `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founderWithDrafts(): Promise<E2EUser> {
  const db = admin();
  const user = { email: `voice-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  expect(created.error).toBeNull();
  user.id = created.data.user!.id;
  const posts = await db.from("content_items").insert([
    {
      user_id: user.id, department: "post", platform: "X", day: new Date().toISOString().slice(0, 10), idea: "Invoices", status: "in_review",
      body: { text: "Duely is the best invoicing tool ever made. Sign up today!", alternates: ["Most late invoices are forgotten, not refused.", "A reminder on day 3 fixes most of them, and here is the long story of how we found out over two years of trying."] },
    },
  ]);
  expect(posts.error).toBeNull();
  return user;
}

test("rate three drafts, accept two rules, see them in Library → Voice", async ({ page }) => {
  const user = await founderWithDrafts();
  await signIn(page, user);
  await page.goto("/app/library?tab=voice");
  await page.getByRole("button", { name: "Rate your drafts" }).click();
  const sheet = page.getByTestId("rating-sheet");
  const drafts = sheet.getByTestId("rating-draft");
  await expect(drafts).toHaveCount(3);

  await drafts.nth(0).getByRole("button", { name: /Not good/ }).click();
  await drafts.nth(0).getByRole("button", { name: "Too salesy" }).click();
  await drafts.nth(1).getByRole("button", { name: /Good/ }).first().click();
  await drafts.nth(2).getByRole("button", { name: /Not good/ }).click();
  await drafts.nth(2).getByRole("button", { name: "Too long" }).click();
  await sheet.getByRole("button", { name: "Send 3 ratings" }).click();

  await expect(sheet.getByRole("heading", { name: "Your CMO learned:" })).toBeVisible({ timeout: 60_000 });
  await expect(sheet.getByTestId("rating-rule")).toHaveCount(2);
  await sheet.getByRole("button", { name: "Use these rules" }).click();
  await expect(sheet).toContainText("2 rules saved.");
  await sheet.getByRole("button", { name: "Done" }).click();

  // Rating decided nothing: the post card still waits.
  expect((await admin().from("approvals").select("status").eq("user_id", user.id).eq("kind", "post")).data).toEqual([{ status: "waiting" }]);
  await page.reload();
  await expect(page.getByTestId("voice-rule")).toHaveCount(2);
  await expect(page.locator("#library-voice-rules")).toContainText("Help first: drop the pitch and the hype.");
  await expect(page.locator("#library-voice-rules")).toContainText("From your ratings");
  await expect(page.getByTestId("voice-event")).toHaveCount(2);
});

test("edit a rule on the Voice page, Undo, and it reads as before", async ({ page }) => {
  const user = await founderWithDrafts();
  const db = admin();
  expect((await db.from("cmo_corrections").insert({ user_id: user.id, rule: "Keep it short: one idea, no extra lines.", status: "active", decided_at: new Date().toISOString() })).error).toBeNull();
  await signIn(page, user);
  await page.goto("/app/library?tab=voice");
  const rules = page.locator("#library-voice-rules");
  await rules.getByRole("button", { name: /^Edit rule/ }).click();
  await rules.getByLabel("The rule, in your words (up to 200 characters)").fill("Keep it short: under 200 characters.");
  await rules.getByRole("button", { name: "Save rule" }).click();
  await expect(rules).toContainText("Keep it short: under 200 characters.");
  await expect(page.getByTestId("voice-event").first()).toContainText("Rule changed");

  await page.locator("#library-voice-history").getByRole("button", { name: "Undo" }).click();
  await expect(rules).toContainText("Keep it short: one idea, no extra lines.");
  await expect(page.getByTestId("voice-event").first()).toHaveAttribute("data-undone", "true");
});
