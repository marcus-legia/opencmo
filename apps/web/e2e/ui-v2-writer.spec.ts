import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { E2EUser } from "./global-setup";
import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * P3 Writer for every platform (sessions/C.md). C0: the Threads and LinkedIn post cards and the captions on the
 * Studio cards, on fixtures, at 1440 and 390 with axe. C2: the correction card on live rows. v2 build only:
 * `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-10-28-p3-acceptance", "c");

async function axeAndShot(page: Page, name: string, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Sample cards (`SAMPLE_CARDS`), opened the way the digest links to them; the caption editors are opened too. */
const CARDS: { name: string; id: string; open?: string }[] = [
  { name: "card-threads", id: "card-post-threads" },
  { name: "card-linkedin", id: "card-post-linkedin" },
  { name: "card-shorts-captions", id: "card-shorts", open: "Edit TikTok caption" },
  { name: "card-finished-captions", id: "card-finished", open: "Edit YouTube title and description" },
  { name: "card-correction", id: "card-correction" },
];

for (const sample of CARDS) {
  test(`${sample.name}: no serious axe violation at 1440 and 390, editor open too`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await signIn(page, state().users.a);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      await page.goto(`/app/inbox/${sample.id}`);
      await expect(page.getByTestId("inbox-card-page").getByTestId("approval-card")).toBeVisible();
      await axeAndShot(page, sample.name, width);
      if (sample.open) {
        await page.getByRole("button", { name: sample.open }).first().click();
        await axeAndShot(page, `${sample.name}-editing`, width);
      }
    }
  });
}

test("LinkedIn shows where “more” cuts the post; Threads and LinkedIn approve and open their composer", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.goto("/app/inbox/card-post-linkedin");
  const card = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(card).toContainText("The first 140 characters show before “more” on a phone.");
  await expect(card.locator(".v2-card-fold")).toHaveCount(1);
  await expect(card).toContainText("/3000");
  await expect(card.getByRole("button", { name: "Approve, copy and open LinkedIn" })).toBeVisible();

  await page.goto("/app/inbox/card-post-threads");
  const threads = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(threads).toContainText("/500");
  await expect(threads.locator(".v2-card-fold")).toHaveCount(0);
  // The composer is never really reached from a test: the tab's address is what the founder would land on.
  await page.context().route("https://www.threads.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Threads</title>" }));
  const popup = page.waitForEvent("popup");
  await threads.getByRole("button", { name: "Approve and open Threads" }).click();
  const tab = await popup;
  await expect.poll(() => tab.url()).toContain("threads.com/intent/post?text=I%20spent%20more%20time");
  await tab.close();
});

test("a caption counts its limit and hashtags per platform; too many hashtags cannot be saved", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.goto("/app/inbox/card-shorts");
  const card = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  const tiktok = card.getByTestId("caption").filter({ hasText: "TikTok caption" }).first();
  await expect(tiktok).toContainText("#2/5");
  await tiktok.getByRole("button", { name: "Edit TikTok caption" }).click();
  await tiktok.getByLabel("Caption").fill("Cut by words #a1 #b #c #d #e #f");
  await expect(tiktok).toContainText("At most 5 hashtags here.");
  await expect(tiktok.getByRole("button", { name: "Save caption" })).toBeDisabled();
  await tiktok.getByLabel("Caption").fill("Cut your demo by deleting words. #editing");
  await tiktok.getByRole("button", { name: "Save caption" }).click();
  await expect(tiktok).toContainText("Cut your demo by deleting words. #editing");
  await expect(tiktok).toContainText("#1/5");
});

// ------------------------------------------------------------------ live rows

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

/** A founder of their own per test, past Setup. */
async function founder(db: SupabaseClient): Promise<E2EUser> {
  const user = { email: `writer-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  expect(created.error).toBeNull();
  user.id = created.data.user!.id;
  const doc = await db
    .from("marketing_documents")
    .insert({ user_id: user.id, kind: "product", version: 1, created_by: "user", body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } });
  expect(doc.error).toBeNull();
  return user;
}

/** Three X posts the founder approved after rewriting the first line: the third raises a correction card. */
async function repeatedEdits(db: SupabaseClient, userId: string) {
  const edits = [
    ["Tired of editing demos?", "Editing a demo should not take longer than building it."],
    ["What if you could cut by words?", "Cut a video by deleting words."],
    ["Ever wished B-roll found itself?", "B-roll lands on the line you mean."],
  ];
  const day = new Date().toISOString().slice(0, 10);
  for (const [index, [before, after]] of edits.entries()) {
    const id = randomUUID();
    const item = await db.from("content_items").insert({ id, user_id: userId, department: "post", platform: "X", day, idea: `Idea ${index}`, status: "approved", body: { text: before }, final_text: after });
    expect(item.error).toBeNull();
    const decidedAt = new Date(Date.now() - (3 - index) * 3_600_000).toISOString();
    const outcome = await db
      .from("cmo_draft_outcomes")
      .insert({ user_id: userId, item_id: id, department: "post", action: "approve", chosen_version: 0, similarity: 0.3, edit_mode: "HOOK_REWRITTEN", classified_at: decidedAt, decided_at: decidedAt });
    expect(outcome.error).toBeNull();
  }
  const { data } = await db.from("approvals").select("id, content_hash, ref_id").eq("user_id", userId).eq("kind", "correction").eq("status", "waiting").single();
  expect(data).not.toBeNull();
  return data as { id: string; content_hash: string; ref_id: string };
}

test("a correction card shows the repeated edit with two examples; a stale hash is refused; dismiss and keep decide it", async ({ page }) => {
  const db = admin();
  const user = await founder(db);
  const card = await repeatedEdits(db, user.id);
  await signIn(page, user);

  const stale = await page.request.post(`/api/v1/approvals/${card.id}`, { data: { action: "approve", contentHash: "0".repeat(64) } });
  expect(stale.ok()).toBeFalsy();
  expect(JSON.stringify(await stale.json())).toMatch(/changed/);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.goto(`/app/inbox/${card.id}`);
    const view = page.getByTestId("inbox-card-page").getByTestId("approval-card");
    await expect(view).toContainText("You rewrote the first line in 3 posts these two weeks.");
    await expect(view).toContainText("from 3 edits");
    await expect(view.getByRole("list", { name: "Your edits" }).getByRole("listitem")).toHaveCount(2);
    await expect(view).toContainText("B-roll lands on the line you mean.");
    await axeAndShot(page, "live-correction", width);
  }
  const view = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await view.getByRole("button", { name: "Dismiss" }).click();
  await view.getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(async () => (await db.from("cmo_corrections").select("status").eq("id", card.ref_id).single()).data?.status).toBe("rejected");
  await expect.poll(async () => (await db.from("approvals").select("status").eq("id", card.id).single()).data?.status).toBe("skipped");

  // Another founder keeps the rule: it becomes a rule every draft reads first.
  const other = await founder(db);
  const second = await repeatedEdits(db, other.id);
  await page.context().clearCookies();
  await signIn(page, other);
  await page.goto(`/app/inbox/${second.id}`);
  await page.getByTestId("inbox-card-page").getByRole("button", { name: "Keep as a rule" }).click();
  await expect.poll(async () => (await db.from("cmo_corrections").select("status").eq("id", second.ref_id).single()).data?.status).toBe("active");
});

test("Library → Voice: notes with platform, source and weight; delete asks first; skills say who reads them", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await signIn(page, state().users.a);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.goto("/app/library?tab=voice&sample=1");
    const notes = page.getByTestId("voice-note");
    await expect(notes).toHaveCount(3);
    await expect(notes.first()).toContainText("All platforms · From your edit: wrong voice");
    await expect(notes.nth(1)).toContainText("LinkedIn");
    await expect(page.getByRole("meter", { name: "Weight of “Short sentences, one idea each.”" })).toBeVisible();
    await page.getByRole("button", { name: "Delete note: “We” on X, “I” on LinkedIn." }).click();
    await expect(page.getByRole("group", { name: "Delete note: “We” on X, “I” on LinkedIn.?" })).toBeVisible();
    await axeAndShot(page, "library-voice-confirm", width);
    await page.getByRole("button", { name: "Keep" }).click();
    await expect(notes).toHaveCount(3);
    await page.getByRole("button", { name: "Delete note: “We” on X, “I” on LinkedIn." }).click();
    await page.getByRole("button", { name: "Delete note", exact: true }).click();
    await expect(notes).toHaveCount(2);

    await page.goto("/app/library?tab=skills&sample=1");
    await expect(page.getByText("Read by Writer, Checker, Sales, CMO chat")).toBeVisible();
    await expect(page.getByRole("main").getByRole("switch")).toHaveCount(0);
    await axeAndShot(page, "library-skills", width);
  }
});

test("Writer filters drafts per platform", async ({ page }) => {
  await signIn(page, state().users.a);
  await page.goto("/app/writer?sample=1");
  const cards = page.locator(".scr-board-card");
  await expect(cards).toHaveCount(8);
  const filter = page.getByRole("group", { name: "Platform" });
  await filter.getByRole("button", { name: "LinkedIn", exact: true }).click();
  await expect(cards).toHaveCount(4);
  await filter.getByRole("button", { name: "X", exact: true }).click();
  await expect(cards).toHaveCount(4);
});
