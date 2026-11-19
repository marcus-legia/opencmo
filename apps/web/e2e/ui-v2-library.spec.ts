import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";

/**
 * The Library (wave 3, C1): what people said in the conversations Sales kept, by theme, with the source filter, the
 * left panel's count and "Write a post from this" filling the CMO chat's box (the founder sends it). The rows are seeded
 * the way `cmo_save_library` stores them. Screenshots: `test-results/library-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founderWithLibrary() {
  const db = admin();
  const email = `e2e-library-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "e2e-library-password";
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the founder: ${error?.message}`);
  const userId = data.user.id;

  const threads = [
    { url: "https://www.reddit.com/r/freelance/comments/e2e1/late_invoices/", platform: "reddit", community: "freelance", title: "How do you chase late invoices?" },
    { url: "https://www.reddit.com/r/SaaS/comments/e2e2/net30/", platform: "reddit", community: "SaaS", title: "Net 30 always becomes net 45" },
    { url: "https://news.ycombinator.com/item?id=4242", platform: "hn", community: "Ask HN", title: "Ask HN: invoicing tools?" },
  ];
  const { data: opps, error: oppError } = await db
    .from("opportunities")
    .insert(threads.map((t) => ({ ...t, user_id: userId, score: 80, posted_at: new Date().toISOString() })))
    .select("id, url");
  if (oppError || !opps) throw new Error(`could not seed the threads: ${oppError?.message}`);
  const id = (url: string) => opps.find((o) => o.url === url)!.id;

  const { data: themes, error: themeError } = await db
    .from("library_themes")
    .insert([
      { user_id: userId, name: "Chasing late invoices" },
      { user_id: userId, name: "Spreadsheets break" },
    ])
    .select("id, name");
  if (themeError || !themes) throw new Error(`could not seed the themes: ${themeError?.message}`);
  const theme = (name: string) => themes.find((t) => t.name === name)!.id;

  const { error: entryError } = await db.from("library_entries").insert([
    {
      opportunity_id: id(threads[0]!.url),
      user_id: userId,
      theme_id: theme("Chasing late invoices"),
      summary: "Chases three clients a month by hand",
      quotes: [{ kind: "pain", text: "I spend every Friday chasing invoices instead of working" }],
      platform: "reddit",
      community: "freelance",
      posted_at: new Date().toISOString(),
    },
    {
      opportunity_id: id(threads[1]!.url),
      user_id: userId,
      theme_id: theme("Chasing late invoices"),
      summary: "Clients agree to net 30 and pay at 45",
      quotes: [{ kind: "pain", text: "Every client says net 30 and pays at 45" }],
      platform: "reddit",
      community: "SaaS",
      posted_at: new Date().toISOString(),
    },
    {
      opportunity_id: id(threads[2]!.url),
      user_id: userId,
      theme_id: theme("Spreadsheets break"),
      summary: "Tracks invoices in a spreadsheet that breaks every month",
      quotes: [{ kind: "evidence", text: "Spreadsheets plus calendar reminders. It breaks every month." }],
      platform: "hn",
      community: "Ask HN",
      posted_at: new Date().toISOString(),
    },
  ]);
  if (entryError) throw new Error(`could not seed the Library: ${entryError.message}`);
  return { email, password, id: userId };
}

test("the Library: themes with their quotes, the source filter, the left panel count, a post from a theme", async ({ page }) => {
  test.setTimeout(120_000);
  const user = await founderWithLibrary();
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/library");

  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  const cards = page.getByTestId("library-theme");
  await expect(cards).toHaveCount(2);
  // Most talked about first, with the people's own words and where they said them.
  const first = cards.first();
  await expect(first.getByRole("heading", { name: "Chasing late invoices" })).toBeVisible();
  await expect(first).toContainText("2 conversations");
  await expect(first).toContainText("+2 this week");
  await expect(first.getByTestId("library-quote")).toHaveCount(2);
  await expect(first).toContainText("I spend every Friday chasing invoices instead of working");
  await expect(first).toContainText("r/freelance");
  await expect(first).toContainText("Not used in a post yet");

  // The filter counts each source and keeps it in the URL.
  const filters = page.getByRole("navigation", { name: "Filter by source" });
  await expect(filters.getByRole("link", { name: "All 3" })).toHaveAttribute("aria-current", "page");
  await expect(filters.getByRole("link", { name: "Reddit 2" })).toBeVisible();
  await page.screenshot({ path: "test-results/library-1440.png" });
  await filters.getByRole("link", { name: "Hacker News 1" }).click();
  await expect(page).toHaveURL(/\/app\/library\?source=hn$/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Spreadsheets break");
  await expect(cards.first()).toContainText("Hacker News · Ask HN");
  await filters.getByRole("link", { name: "Threads 0" }).click();
  await expect(page.getByTestId("library-empty")).toContainText("Nothing from Threads yet.");

  // The left panel links here with the count.
  const link = page.getByTestId("context-library");
  await expect(link).toContainText("3 conversations");
  await expect(link).toContainText("+3 this week");
  await link.click();
  await expect(page).toHaveURL(/\/app\/library$/);

  // "Write a post from this" puts the request in the chat's box; nothing is sent for the founder.
  await cards.first().getByRole("button", { name: "Write a post from this" }).click();
  await expect(page.locator("#v2-chat textarea")).toHaveValue('Write a post from what people said about "Chasing late invoices" in my Library.');
  const { count: runs } = await admin().from("cmo_runs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  expect(runs).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app/library");
  await expect(cards).toHaveCount(2);
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/library-390.png", fullPage: true });
});

test("a new founder's Library says where its quotes will come from", async ({ page }) => {
  const db = admin();
  const email = `e2e-library-empty-${Date.now()}@test.local`;
  const password = "e2e-library-password";
  const { data } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  await signIn(page, { email, password, id: data.user!.id });
  await page.goto("/app/library");
  await expect(page.getByTestId("library-empty")).toContainText("Nothing saved yet.");
  await expect(page.getByTestId("library-empty").getByRole("link", { name: "Open Sales" })).toHaveAttribute("href", "/app/sales");
});
