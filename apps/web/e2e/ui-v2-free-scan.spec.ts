import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * The free scan (plan 2026-11-18, C2; review 2026-11-21): an unpaid founder's scan shows how many people asked, their
 * words, replies locked behind "See plans" (which opens the plan sheet); a scan that found no one while a place was
 * down says what it read, offers Edit Strategy and says the free scan is still there. Seeded as the scan stores them.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function freeFounder(tag: string) {
  const db = admin();
  const email = `e2e-free-${tag}-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  const docs = await db.from("marketing_documents").insert({ user_id: userId, ...ONBOARDING_DOCUMENT });
  if (docs.error) throw new Error(`could not seed a document: ${docs.error.message}`);
  return { db, user: { email, password, id: userId } };
}

async function freeScanRun(db: ReturnType<typeof admin>, userId: string, output: Record<string, unknown>) {
  const now = new Date().toISOString();
  const run = await db
    .from("cmo_runs")
    .insert({ user_id: userId, kind: "sales_scan", status: "done", credits: 0, input: {}, output: { free: true, ...output }, finished_at: now })
    .select("id")
    .single();
  if (run.error) throw new Error(`could not seed the free scan: ${run.error.message}`);
  return run.data.id as string;
}

test("a free scan that found people: the count, their words, replies behind See plans", async ({ page }) => {
  const { db, user } = await freeFounder("found");
  const runId = await freeScanRun(db, user.id, { cards: 2, platforms: ["reddit", "hn"], failed: [], queries: ["late invoices"], scanned: 30, verdict: "found" });
  const now = new Date().toISOString();
  const rows = [
    { url: "https://www.reddit.com/r/SaaS/comments/e2efree1/late/", platform: "reddit", community: "SaaS", title: "Clients pay me 60 days late", author: "u/free_one", score: 82 },
    { url: "https://news.ycombinator.com/item?id=4242001", platform: "hn", community: "Ask HN", title: "Ask HN: how do you chase invoices?", author: "free_two", score: 71 },
  ];
  const opps = await db.from("opportunities").insert(rows.map((r) => ({ ...r, user_id: user.id, run_id: runId, posted_at: now, reply: "", rule: "no_product_mention" })));
  if (opps.error) throw new Error(`could not seed the threads: ${opps.error.message}`);

  await signIn(page, user);
  await page.goto("/app/sales");
  const result = page.getByTestId("sales-free-result");
  await expect(result).toContainText("2 people asked");
  await expect(page.getByText("Clients pay me 60 days late")).toBeVisible();
  await result.getByRole("button", { name: "See plans" }).click();
  await expect(page.getByTestId("plan-sheet")).toBeVisible();
  await page.screenshot({ path: "test-results/free-scan-found-1440.png" });
});

test("a free scan that found no one while Reddit was down: says what it read, Edit Strategy, the free scan is still there", async ({ page }) => {
  const { db, user } = await freeFounder("none");
  await freeScanRun(db, user.id, { cards: 0, platforms: ["reddit", "hn"], failed: ["reddit"], queries: ["late invoices", "chasing clients"], scanned: 12, verdict: "none" });

  await signIn(page, user);
  await page.goto("/app/sales");
  const none = page.getByTestId("sales-none");
  await expect(none.getByRole("heading")).toContainText("No one asked on Hacker News");
  await expect(none.getByRole("heading")).toContainText("Reddit did not answer");
  await expect(none.getByRole("link", { name: "Edit Strategy" })).toHaveAttribute("href", "/app/business?d=strategy");
  await expect(page.getByTestId("sales-none-free-left")).toBeVisible();
  await page.screenshot({ path: "test-results/free-scan-none-1440.png" });
});
