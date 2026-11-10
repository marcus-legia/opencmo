import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { openFeedCard, showAssistant, signIn, state } from "./helpers";

/**
 * cmo-review-2 S2 and CMO review 3, 3.1 (the free first run, the first week within minutes, the rail, `/video` hidden, "I posted it"), on the local
 * stack with the fake model (`OPENCMO_AGENT_FAKE=1`) and a `.test` website (`readSite`'s e2e fake: the stack has no DNS).
 * Times measured here are the fake model's, not Claude's: they prove the chain runs without waiting for Monday.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founder(credits: number) {
  const email = `e2e-s2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const password = "e2e-s2-password";
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create the founder: ${error?.message}`);
  if (credits) await admin().from("credit_ledger").insert({ user_id: data.user.id, delta: credits, reason: "E2E top-up" });
  return { email, password, id: data.user.id };
}

const post = (page: Page, path: string, data: unknown) =>
  page.request.post(path, { data, headers: { origin: new URL(page.url() || "http://127.0.0.1:3100").origin } });

test("the free first run: website → documents, plan and drafts with no payment, then Approve asks for a plan", async ({ page }) => {
  test.setTimeout(240_000);
  const user = await founder(0);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  // CMO review 3, 3.1: a new account goes to Setup, not Billing.
  await page.goto("/app?site=paylane.test");
  await expect(page).toHaveURL(/\/app\/setup\?site=paylane\.test/);
  await page.getByRole("button", { name: "Read my website" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 180_000 });

  const db = admin();
  await expect
    .poll(async () => {
      const [plans, drafts] = await Promise.all([
        db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "plan").eq("status", "waiting"),
        db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "post").eq("status", "waiting"),
      ]);
      return (plans.count ?? 0) > 0 && (drafts.count ?? 0) > 0;
    }, { timeout: 150_000, intervals: [2_000] })
    .toBe(true);
  // Nothing was charged: the free runs hold no credits.
  const { data: runs } = await db.from("cmo_runs").select("kind, credits").eq("user_id", user.id).in("kind", ["plan_week", "post_draft"]);
  expect((runs ?? []).length).toBeGreaterThan(0);
  expect((runs ?? []).every((run) => run.credits === 0)).toBe(true);
  const { count: holds } = await db.from("credit_ledger").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  expect(holds).toBe(0);

  // Planning again is paid work: a clear 402 with the plan code, before any model call.
  const again = await post(page, "/api/v1/cmo/runs", { kind: "plan_week" });
  expect(again.status()).toBe(402);
  expect(((await again.json()) as { detail: { code: string } }).detail.code).toBe("plan_required");

  // Approve on the post card answers with the plan sheet; the draft stays waiting.
  await page.reload();
  const card = await openFeedCard(page, /X post ·/);
  await card.getByRole("button", { name: /^Approve( for this time)?$/ }).click();
  await expect(page.getByTestId("plan-sheet")).toBeVisible();
  await expect(page.getByTestId("plan-sheet")).toContainText("Your first plan and drafts were free");
  const { count: waiting } = await db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "post").eq("status", "waiting");
  expect(waiting).toBeGreaterThan(0);
});

test("unpaid onboarding: two runs ever, then the plan code", async ({ page }) => {
  const user = await founder(0);
  await signIn(page, user);
  await page.goto("/app/setup");
  // Two earlier runs that did not fail (a typo's site, then the real one): the third is refused before any website is
  // read. Runs that failed on our side would not count.
  await admin().from("cmo_runs").insert([
    { user_id: user.id, kind: "onboard", status: "done", input: { site: "paylane.tset" } },
    { user_id: user.id, kind: "onboard", status: "done", input: { site: "paylane.test" } },
  ]);
  const refused = await post(page, "/api/v1/cmo/onboarding", { site: "paylane.test" });
  expect(refused.status()).toBe(402);
  expect(((await refused.json()) as { detail: { code: string } }).detail.code).toBe("plan_required");
});

test("the first week: website → plan card and a first draft, then I posted it with no X account", async ({ page }) => {
  test.setTimeout(240_000);
  const user = await founder(50);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/app?site=paylane.test");
  await expect(page).toHaveURL(/\/app\/setup\?site=paylane\.test/);

  // One step: the website, already filled in from the landing page.
  await expect(page.getByRole("heading", { name: "Start with your website." })).toBeVisible();
  await expect(page.getByLabel("Your website")).toHaveValue("paylane.test");
  const started = Date.now();
  await page.getByRole("button", { name: "Read my website" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 60_000 });

  // The agents follow the CMO loop: Planner, then Writer, Studio, Publisher (Main.dc.html's agent list).
  const team = page.getByRole("region", { name: "Your team" });
  await expect(team.getByRole("link", { name: /^Writer/ })).toBeVisible();
  const labels = (await team.locator("a").allInnerTexts()).map((text) => text.split("\n")[0]!.trim()).filter(Boolean);
  const order = ["Planner", "Writer", "Studio", "Publisher"].map((name) => labels.findIndex((label) => label.startsWith(name)));
  expect(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]!)), labels.join(" | ")).toBe(true);

  // The plan and today's draft arrive without waiting for Monday.
  const db = admin();
  await expect
    .poll(async () => {
      const [plans, drafts] = await Promise.all([
        db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "plan").eq("status", "waiting"),
        db.from("approvals").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", "post").eq("status", "waiting"),
      ]);
      return (plans.count ?? 0) > 0 && (drafts.count ?? 0) > 0;
    }, { timeout: 150_000, intervals: [2_000] })
    .toBe(true);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`[S2] website submitted → plan card and first draft card: ${seconds} s (fake model)`);

  // No AI video in the week.
  const { data: items } = await db.from("content_items").select("department, platform").eq("user_id", user.id);
  expect((items ?? []).filter((item) => item.department === "video" && item.platform !== "Slideshow")).toEqual([]);

  // The X draft, with no X account: Open X and I posted it on the card itself.
  await page.reload();
  const card = await openFeedCard(page, /X post ·/);
  await expect(card.getByRole("button", { name: "Open X" })).toBeVisible();
  const cardId = await card.getAttribute("data-card-id");
  const posted = page.waitForResponse((response) => response.url().endsWith(`/approvals/${cardId}/posted`));
  await card.getByRole("button", { name: "I posted it" }).click();
  expect((await posted).status()).toBe(200);
  await expect(page.locator(`[data-card-id="${cardId}"]`)).toHaveCount(0);

  const { data: approval } = await db.from("approvals").select("status, ref_id").eq("id", cardId!).single();
  expect(["approved", "edited"]).toContain(approval!.status);
  const { data: item } = await db.from("content_items").select("status").eq("id", approval!.ref_id).single();
  expect(item!.status).toBe("published");
  const { data: slots } = await db.from("schedule_slots").select("status, deliverable:deliverables!inner(ref_id)").eq("deliverable.ref_id", approval!.ref_id);
  expect((slots ?? []).filter((slot) => ["proposed", "waiting", "due", "reminded"].includes(slot.status))).toEqual([]);
});

test("/video is hidden in the editor's slash menu; the other commands stay", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, state().users.b);
  const created = await page.request.post("/api/v1/editor/new", { data: { aspect: "9:16", name: "S2 slash e2e" } });
  expect(created.status(), await created.text()).toBe(200);
  const { clip_id: clipId } = (await created.json()) as { clip_id: string };

  // What the menu is built from, then the menu itself.
  const session = await page.request.get(`/api/v1/agent/sessions?clip_id=${clipId}`);
  expect(session.ok()).toBe(true);
  const names = ((await session.json()) as { slash?: { name: string }[] }).slash?.map((command) => command.name) ?? [];
  expect(names).not.toContain("video");
  expect(names).toEqual(expect.arrayContaining(["image", "animate", "broll", "intro"]));

  await page.goto(`/app/editor/${clipId}`);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await showAssistant(page);
  await page.getByPlaceholder(/type \/ for commands/).fill("/");
  const menu = page.getByTestId("assistant-slash");
  await expect(menu.getByTestId("slash-animate")).toBeVisible();
  await expect(menu.getByTestId("slash-video")).toHaveCount(0);
});
