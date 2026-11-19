import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Wave 3, C8: Research's chat (B7's find_competitors on the fake readers: two names, Add asks for the site), Sales'
 * scan problems (no Strategy, a scan that did not finish, a place that did not answer) and Settings › Tracking.
 * Screenshots: `test-results/wave3-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const db = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founder(page: Page, opts: { strategy?: boolean; site?: string } = {}) {
  const admin = db();
  const email = `e2e-w3-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const id = created.data.user!.id;
  expect((await admin.from("marketing_documents").insert({ user_id: id, ...ONBOARDING_DOCUMENT })).error).toBeNull();
  if (opts.strategy) {
    const doc = { user_id: id, kind: "strategy", version: 1, created_by: "user", body: { icp: "Freelance designers", pains: ["late invoices"], where_they_ask: ["r/freelance"], positioning: "", value_props: [], this_week: "" } };
    expect((await admin.from("marketing_documents").insert(doc)).error).toBeNull();
  }
  if (opts.site) {
    const run = { user_id: id, kind: "onboard", status: "done", input: { site: opts.site }, finished_at: new Date().toISOString() };
    expect((await admin.from("cmo_runs").insert(run)).error).toBeNull();
  }
  await signIn(page, { email, password, id });
  return id;
}

test("Research's chat finds names people mention and adds one with its site", async ({ page }) => {
  test.setTimeout(120_000);
  const userId = await founder(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/research");
  const chat = page.getByTestId("research-chat");
  await expect(chat).toBeVisible();
  await chat.getByLabel("What do the tools do, in your customers' words?").fill("chase unpaid invoices");
  await chat.getByRole("button", { name: "Find them" }).click();
  const ideas = chat.getByTestId("research-idea");
  await expect(ideas.first()).toContainText("Chaser");
  await expect(ideas.first()).toContainText("2 mentions");
  await expect(ideas).toHaveCount(2);
  await page.screenshot({ path: "test-results/wave3-research-chat-1440.png" });

  // Nothing is added until the founder presses Add and gives the site.
  expect((await db().from("competitors").select("id").eq("user_id", userId)).data).toEqual([]);
  await ideas.first().getByRole("button", { name: "Add" }).click();
  await ideas.first().getByLabel("Its website").fill("chaser.test");
  await ideas.first().getByRole("button", { name: "Add" }).click();
  await expect(ideas.first().getByRole("status")).toHaveText("Added to your competitors.");
  const { data: row } = await db().from("competitors").select("site, added_via").eq("user_id", userId).single();
  expect(row).toEqual({ site: "chaser.test", added_via: "chat" });

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/wave3-research-chat-390.png", fullPage: true });
});

test("Sales says when it has no Strategy, when a scan did not finish, and when a place did not answer", async ({ page }) => {
  test.setTimeout(120_000);
  const userId = await founder(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/sales");
  await expect(page.getByTestId("sales-not-set-up")).toBeVisible();
  await expect(page.getByTestId("sales-not-set-up").getByRole("link", { name: "Open Your business" })).toHaveAttribute("href", "/app/business?d=strategy");

  // A scan that read Reddit but not Hacker News, then a newer one that failed.
  const admin = db();
  const output = { cards: 1, skipped: 0, dropped: 0, refund: false, platforms: ["reddit", "hn"], failed: ["hn"], free: false, queries: ["late invoices"], scanned: 3, verdict: "found" };
  const done = await admin.from("cmo_runs").insert({ user_id: userId, kind: "sales_scan", status: "done", output, created_at: new Date(Date.now() - 3_600_000).toISOString(), finished_at: new Date(Date.now() - 3_500_000).toISOString() });
  expect(done.error).toBeNull();
  await page.reload();
  await expect(page.getByTestId("sales-source-down")).toContainText("Hacker News did not answer in the last scan");
  await expect(page.getByTestId("sales-scan-failed")).toHaveCount(0);

  const failed = await admin.from("cmo_runs").insert({ user_id: userId, kind: "sales_scan", status: "failed", error: "Reddit did not answer. Try again in a minute.", finished_at: new Date().toISOString() });
  expect(failed.error).toBeNull();
  await page.reload();
  await expect(page.getByTestId("sales-scan-failed")).toContainText("Reddit did not answer. Try again in a minute.");
  await page.screenshot({ path: "test-results/wave3-sales-problems-1440.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/wave3-sales-problems-390.png", fullPage: true });
});

test("a founder with a Strategy sees no set-up banner", async ({ page }) => {
  test.setTimeout(60_000);
  await founder(page, { strategy: true });
  await page.goto("/app/sales");
  await expect(page.getByTestId("v2-sales")).toBeVisible();
  await expect(page.getByTestId("sales-not-set-up")).toHaveCount(0);
});

test("Settings › Tracking gives one link per place, with Copy", async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await founder(page, { site: "https://paylane.test/" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/settings#settings-tracking");
  const panel = page.getByTestId("settings-tracking");
  await expect(panel).toBeVisible();
  const links = panel.getByTestId("tracking-link");
  await expect(links).toHaveCount(6);
  await expect(links.first()).toContainText("https://paylane.test/?ref=ferreto&src=reddit");
  await expect(panel).toContainText("counts the people you mark as signed up in Sales › Following up");
  await links.first().getByRole("button", { name: "Copy the Reddit link" }).click();
  await expect(links.first().getByRole("button", { name: "Copy the Reddit link" })).toHaveText("Copied");
  await panel.screenshot({ path: "test-results/wave3-tracking-1440.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
});
