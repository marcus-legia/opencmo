import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Wave 4a, session C (plan docs/plans/cmo/2026-11-20-wave4-plan.md):
 * - C1, Sales and Feed on a phone (canvas board "Sales on a phone"): the list first, a thread opens full width with a
 *   way back, the reach tabs as one segmented control, "Copy and open thread" held at the bottom, the Context column
 *   as a sheet from the top bar, Feed rows with their actions in one row; 44 px targets, no sideways scroll at 390 and
 *   360.
 * - C2, the missing states: 100% used (Sales, Post, Feed, Billing), a free account after its free scan (one locked
 *   card on Post and on Feed), and the reach level on the Feed's Sales card.
 * - C5, the look: Sales, Feed, Billing and Settings at 1440, 390 and 360 on seeded data, never on "Loading…".
 * Screenshots land in docs/shots/2026-11-20-wave4-shots/.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const OUT = join(__dirname, "..", "..", "..", "docs", "shots", "2026-11-20-wave4-shots");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

const must = (r: { error: { message: string } | null }, what: string) => {
  if (r.error) throw new Error(`Could not seed ${what}: ${r.error.message}`);
};

async function founder(prefix: string): Promise<E2EUser> {
  const db = admin();
  const user: E2EUser = { email: `${prefix}-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  user.id = created.data.user!.id;
  must(await db.from("marketing_documents").insert({ user_id: user.id, ...ONBOARDING_DOCUMENT }), "a document");
  must(await db.from("marketing_documents").insert({ user_id: user.id, kind: "strategy", version: 1, created_by: "user", body: { summary: "Solo founders who bill clients" } }), "the strategy");
  return user;
}

const reach = (over: Record<string, unknown>) => ({
  buyer: true,
  wantsNow: true,
  warm: false,
  fresh: true,
  dmAllowed: true,
  asksForTools: true,
  emailFound: null,
  reasons: ["Says who they are: “I run a two-person studio”", "Wants a fix now", "Asks for tools, but has not answered you yet", "Posted today", "Reddit allows DMs"],
  ...over,
});

/** A founder with three people found, as the scan stores them (each raises its card on the Feed). */
async function withThreads(): Promise<E2EUser> {
  const db = admin();
  const user = await founder("wave4");
  // Credits on the ledger: Sales reads the drafts (an unpaid account never sees them).
  must(await db.from("credit_ledger").insert({ user_id: user.id, delta: 50, reason: "E2E top-up" }), "credits");
  const postedAt = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const rows = [
    { url: "https://www.reddit.com/r/SaaS/comments/w4dm/invoices_on_time/", platform: "reddit", community: "SaaS", title: "How do you get clients to pay invoices on time without being the bad guy?", score: 86,
      reply: "Six weeks is rough. What worked for me: the due date and late fee on the invoice itself, then the same short reminder on day 3, 7 and 14.\n\nFull disclosure, I built a small tool that sends those reminders. Happy to share it.",
      reach_level: "dm_ready", reach: reach({}), dm_draft: "Hi, saw your post about late invoices. I answered there too. Want the link to the tool I built?" },
    { url: "https://news.ycombinator.com/item?id=434343", platform: "hn", community: "Ask HN", title: "Ask HN: invoicing for solo consultants?", score: 79,
      reply: "I bill monthly and send reminders on day 3, 7 and 14.", reach_level: "reply_first", reach: reach({ dmAllowed: false, reasons: ["Says who they are", "Wants a fix now", "Has not answered you yet", "Posted today", "Hacker News has no DMs"] }) },
    { url: "https://www.reddit.com/r/freelance/comments/w4rt/forty_five_days/", platform: "reddit", community: "freelance", title: "Is it normal to wait 45 days for payment?", score: 64,
      reply: "It is common, and it can change.", reach_level: "reply_first", reach: reach({ buyer: false }) },
  ];
  must(await db.from("opportunities").insert(rows.map((r) => ({ ...r, user_id: user.id, posted_at: postedAt, rule: "mention_ok", rule_why: "r/SaaS allows it if you say it is yours" }))), "the threads");
  return user;
}

/** A Pro founder at 100% of a 100-credit month. */
async function atFullUsage(): Promise<E2EUser> {
  const db = admin();
  const user = await founder("wave4-full");
  const product = `prod_e2e_w4_${user.id.slice(0, 8)}`;
  must(await db.from("billing_catalog").insert({ creem_product_id: product, slug: `e2e-w4-${user.id.slice(0, 8)}`, kind: "plan", plan_id: "starter", credits: 100, price_cents: 6900, interval: "month", on_sale: false }), "the product");
  must(await db.from("profiles").update({ plan: "starter", timezone: "UTC", credit_balance: 200 }).eq("id", user.id), "the plan");
  const now = new Date();
  must(
    await db.from("creem_subscriptions").insert({
      subscription_id: `sub_e2e_w4_${user.id}`,
      customer_id: `cus_e2e_w4_${user.id}`,
      user_id: user.id,
      product_id: product,
      plan: "starter",
      interval: "month",
      status: "active",
      current_period_end: new Date(now.getTime() + 12 * 86_400_000).toISOString(),
      provider_event_at: now.toISOString(),
      status_priority: 1,
      event_id: `evt_e2e_w4_${user.id}`,
    }),
    "the subscription",
  );
  must(await db.from("credit_ledger").insert({ user_id: user.id, delta: -100, reason: "e2e: a month of scans", ref_kind: "cmo_run", ref_id: randomUUID() }), "the usage");
  return user;
}

/** A free founder whose free scan found people and whose free post draft is written (`my_usage_state`: free_scan_used). */
async function afterFreeScan(): Promise<E2EUser> {
  const db = admin();
  const user = await founder("wave4-free");
  must(
    await db.from("cmo_runs").insert([
      { user_id: user.id, kind: "post_draft", status: "done", credits: 0 },
      { user_id: user.id, kind: "sales_scan", status: "done", credits: 0, output: { verdict: "found", cards: 3 } },
    ]),
    "the free runs",
  );
  return user;
}

async function noSideways(page: Page, label: string) {
  const width = page.viewportSize()!.width;
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `${label} @ ${width}, sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(width);
}

/** Every visible button, link and tab a thumb can press is at least 44 px tall (links inside a sentence excepted). */
async function thumbSized(page: Page, scope: string, label: string) {
  const small = await page.locator(scope).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("button, a, select, [role=tab]"))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0 || getComputedStyle(el).visibility === "hidden") return false;
        // A link inside running text is sized by its line (WCAG 2.5.8 exception).
        if (el.tagName === "A" && el.parentElement && /^(P|SPAN|LI)$/.test(el.parentElement.tagName) && (el.parentElement.textContent ?? "").trim() !== (el.textContent ?? "").trim()) return false;
        return box.height < 44;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  );
  expect(small, `${label}: targets under 44 px`).toEqual([]);
}

async function settled(page: Page) {
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator("main").getByText(/^Loading…$/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("main").getByText("Loading your team…")).toHaveCount(0, { timeout: 30_000 });
}

test("C1: Sales on a phone, list then the person full width, sticky Copy and open, Context as a sheet", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const user = await withThreads();
  await signIn(page, user);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/app/sales");
    const list = page.getByRole("list", { name: "Threads" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await settled(page);
    // The list comes first: no thread open on arrival.
    await expect(page.getByTestId("sales-reach")).toHaveCount(0);
    await noSideways(page, "sales list");
    await thumbSized(page, "[data-testid=v2-sales]", `sales list @ ${width}`);
    await thumbSized(page, "header.top", `top bar @ ${width}`);
    // The account stays on the first row of the bar.
    const bar = await page.locator("header.top").evaluate((el) => [...el.children].filter((c) => c.getBoundingClientRect().height > 0).map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(new Set(bar).size, "top bar rows").toBeLessThanOrEqual(2);
    await page.screenshot({ path: join(OUT, `sales-list-${width}.png`), fullPage: true });

    await list.getByRole("listitem").filter({ hasText: "pay invoices on time" }).getByRole("button").first().click();
    const person = page.locator("[data-person=open]");
    await expect(person).toBeVisible();
    await expect(person.getByRole("heading", { level: 1 })).toHaveText("How do you get clients to pay invoices on time without being the bad guy?");
    await expect(page.getByRole("list", { name: "Threads" })).toHaveCount(0);
    // The reach tabs are one row of three.
    const tabs = person.getByRole("tablist", { name: "How to reach them" }).getByRole("tab");
    await expect(tabs).toHaveCount(3);
    const tops = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    // "Copy and open thread" is on screen at the top of the page, held at the bottom.
    const copy = person.getByRole("button", { name: "Copy and open thread" });
    await expect(copy).toBeInViewport();
    const box = (await copy.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(844 - 140);
    expect(box.width).toBeGreaterThan(width - 40);
    await noSideways(page, "sales person");
    await thumbSized(page, "[data-person=open]", `sales person @ ${width}`);
    await page.screenshot({ path: join(OUT, `sales-person-${width}.png`) });
    // The DM tab opens in place for a DM-ready person.
    await tabs.filter({ hasText: "DM" }).click();
    await expect(person.getByTestId("sales-dm")).toBeVisible();

    await person.getByRole("button", { name: "Back to people" }).click();
    await expect(page.getByRole("list", { name: "Threads" }).getByRole("listitem")).toHaveCount(3);

    // The Context column is a sheet opened from the top bar.
    await expect(page.locator("#td-context")).toBeHidden();
    const open = page.getByRole("button", { name: "Context", exact: true });
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    const sheet = page.locator("#td-context");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("context-funnel")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close context" })).toBeFocused();
    await page.screenshot({ path: join(OUT, `context-sheet-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }

  // A decision on a phone goes back to the list, where "Where did you post it?" waits.
  await page.getByRole("list", { name: "Threads" }).getByRole("listitem").filter({ hasText: "Ask HN" }).getByRole("button").first().click();
  await page.locator("[data-person=open]").getByRole("button", { name: "I replied" }).click();
  await expect(page.getByTestId("sales-reply-link")).toBeVisible();
  await expect(page.locator("[data-person=open]")).toHaveCount(0);

  // On a wide screen nothing changed: the first thread opens in place, the Context column is there, no sheet button.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/sales");
  await expect(page.getByTestId("sales-reach")).toBeVisible();
  await expect(page.locator("#td-context")).toBeVisible();
  await expect(page.getByRole("button", { name: "Context", exact: true })).toBeHidden();
});

test("C1 + C2: the Feed on a phone, actions in one row, and the Sales card's reach level", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const user = await withThreads();
  await signIn(page, user);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app");
  const levels = page.getByTestId("feed-reach-level");
  await expect(levels.first()).toBeVisible();
  await expect(levels).toHaveCount(3);
  expect((await levels.allInnerTexts()).sort()).toEqual(["DM ready", "Reply first", "Reply first"]);

  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/app");
    await settled(page);
    const row = page.locator(".item").filter({ hasText: "Is it normal to wait 45 days" });
    await expect(row).toBeVisible();
    // The time, Not now and Review share one row under the title.
    const [later, review] = [row.getByRole("button", { name: "Not now" }), row.getByRole("button", { name: "Review" })];
    const a = (await later.boundingBox())!;
    const b = (await review.boundingBox())!;
    expect(Math.abs(a.y - b.y)).toBeLessThan(4);
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await noSideways(page, "feed");
    await page.screenshot({ path: join(OUT, `feed-${width}.png`), fullPage: true });
  }
  // Open, the card says why: the reach level and its reason.
  const first = page.locator(".item").filter({ hasText: "Is it normal to wait 45 days" });
  await first.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("feed-reach-reason")).toContainText("Reply first ·");
});

test("C2: at 100% Sales, Post, Feed and Billing say what stopped, what still works and when it resets", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = await atFullUsage();
  await signIn(page, user);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, id] of [
    ["/app/sales", "sales-paused"],
    ["/app/writer", "usage-allowance-used"],
    ["/app/schedule", "usage-allowance-used"],
    ["/app", "usage-allowance-used"],
  ] as const) {
    await page.goto(path);
    const banner = page.getByTestId(id);
    await expect(banner).toContainText("You used 100% of this month's allowance");
    await expect(banner).toContainText(/New scans and competitor research stop until \d{1,2} \w+\./);
    await expect(banner).toContainText("The people already found, your drafts and your posts keep working.");
    await expect(banner.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/app/billing#billing-plans");
    await noSideways(page, path);
  }
  await page.goto("/app/sales");
  await page.screenshot({ path: join(OUT, "sales-full-usage-390.png"), fullPage: true });
  await page.goto("/app/billing");
  await expect(page.getByTestId("billing-usage").getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByTestId("billing-usage-full")).toContainText("New scans and competitor research stop until");
  await expect(page.getByTestId("billing-usage").getByRole("link", { name: "See plans" })).toBeVisible();
});

test("C2: a free account after its free scan sees one locked card on Post and on Feed", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = await afterFreeScan();
  await signIn(page, user);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  const feed = page.getByTestId("free-locked-feed");
  await expect(feed).toHaveCount(1);
  await expect(feed).toContainText("Your free scan is done");
  await expect(feed).toContainText("Locked: new scans, reply drafts and new post drafts.");
  await feed.getByRole("button", { name: "See plans" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(OUT, "feed-free-locked-390.png"), fullPage: true });

  await page.goto("/app/writer");
  const post = page.getByTestId("free-locked-post");
  await expect(post).toHaveCount(1);
  await expect(post).toContainText("Your free post draft is used");
  await noSideways(page, "post");
  await page.screenshot({ path: join(OUT, "post-free-locked-390.png"), fullPage: true });
  // A paid founder under the allowance sees neither.
  const paid = await withThreads();
  await page.context().clearCookies();
  await signIn(page, paid);
  await page.goto("/app/writer");
  await expect(page.getByTestId("v2-writer")).toBeVisible();
  await expect(page.getByTestId("free-locked-post")).toHaveCount(0);
  await expect(page.getByTestId("usage-allowance-used")).toHaveCount(0);
});

test("C5 look: Sales, Feed, Billing and Settings at 1440, 390 and 360 on seeded data", async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  const user = await withThreads();
  await signIn(page, user);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [name, path, ready] of [
    ["sales", "/app/sales", "v2-sales"],
    ["feed", "/app", "v2-dashboard"],
    ["billing", "/app/billing", "billing-plan"],
    ["settings", "/app/settings", "settings-delete-account"],
  ] as const) {
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.goto(path);
      await expect(page.getByTestId(ready).filter({ visible: true })).toBeVisible();
      await settled(page);
      await noSideways(page, name);
      await page.screenshot({ path: join(OUT, `look-${name}-${width}.png`), fullPage: true });
    }
  }
});
