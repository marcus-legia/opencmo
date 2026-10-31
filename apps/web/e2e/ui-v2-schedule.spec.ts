import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { E2EUser } from "./global-setup";
import { signIn, state } from "./helpers";

/**
 * P4 Schedule and Publish (sessions/C.md C4), on live rows with the fake Zernio (`OPENCMO_PUBLISH_FAKE=1`, set by
 * `e2e/run.ts`): connect and disconnect an account, approve a schedule card, drag its slot (the card asks again),
 * retry a failed post, and post one yourself from its copy-and-open card. v2 build only: `npm run test:e2e:schedule`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:schedule");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

async function founder(db: SupabaseClient): Promise<E2EUser> {
  const user = { email: `schedule-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  expect(created.error).toBeNull();
  user.id = created.data.user!.id;
  const doc = await db
    .from("marketing_documents")
    .insert({ user_id: user.id, kind: "product", version: 1, created_by: "user", body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } });
  expect(doc.error).toBeNull();
  return user;
}

/** The founder's X account, as B2's callback stores it after the fake Zernio's OAuth. */
async function connectX(db: SupabaseClient, userId: string) {
  expect((await db.rpc("zernio_profile_save", { p_user: userId, p_profile: `prof-${userId}` })).error).toBeNull();
  const saved = await db.rpc("social_account_save", { p_user: userId, p_platform: "x", p_handle: "@founder", p_avatar_url: null, p_zernio_account_id: `acc-${userId}` });
  expect(saved.error).toBeNull();
}

/**
 * A post Writer left for the founder, under its order (as the runner files it), approved by the founder: Schedule
 * proposes its time on a schedule card (A3). Returns the slot and that card.
 */
async function approvedPost(db: SupabaseClient, user: E2EUser, platform: "X" | "LinkedIn", text: string) {
  const week = new Date();
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const order = await db
    .from("work_orders")
    .insert({ user_id: user.id, week: week.toISOString().slice(0, 10), kind: "post_draft", title: `${platform} post`, brief: {}, department: "writer", status: "waiting_founder" })
    .select("id")
    .single();
  expect(order.error).toBeNull();
  const itemId = randomUUID();
  const item = await db
    .from("content_items")
    .insert({ id: itemId, user_id: user.id, department: "post", platform, day: new Date().toISOString().slice(0, 10), idea: text, status: "in_review", body: { text, alternates: [] } });
  expect(item.error).toBeNull();
  expect((await db.from("deliverables").insert({ user_id: user.id, order_id: order.data!.id, kind: "post", ref_kind: "content_item", ref_id: itemId, status: "waiting_founder" })).error).toBeNull();
  const { data: card } = await db.from("approvals").select("id, content_hash").eq("ref_kind", "content_item").eq("ref_id", itemId).eq("status", "waiting").single();

  const me = createClient(state().url, state().anon, { auth: { persistSession: false } });
  expect((await me.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
  const decided = await me.rpc("approval_decide", { p_id: card!.id, p_action: "approve", p_payload: { content_hash: card!.content_hash, via: "app" } });
  expect(decided.error).toBeNull();

  const deliverable = (await db.from("deliverables").select("id").eq("ref_kind", "content_item").eq("ref_id", itemId).single()).data!.id;
  const readSlot = async () =>
    (await db.from("schedule_slots").select("id, platform, mode, status, publish_at, approval_id").eq("deliverable_id", deliverable).maybeSingle()).data as SlotRow | null;
  await expect.poll(readSlot).not.toBeNull();
  const slot = (await readSlot())!;
  return { itemId, slot };
}

type SlotRow = { id: string; platform: string; mode: string; status: string; publish_at: string; approval_id: string | null };

async function openCard(page: Page, id: string) {
  await page.goto(`/app/inbox/${id}`);
  return page.getByTestId("inbox-card-page").getByTestId("approval-card");
}

const mondayOf = (iso: string) => {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

test("Settings → Accounts: connect Threads through the fake Zernio, then disconnect it", async ({ page }) => {
  const db = admin();
  const user = await founder(db);
  await signIn(page, user);
  await page.goto("/app/settings");
  const panel = page.locator("#settings-connected-accounts");
  await panel.getByRole("button", { name: "Connect Threads" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Threads is connected." })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("connected")).toBe(false);
  await expect.poll(async () => (await db.from("social_accounts").select("platform, status").eq("user_id", user.id)).data).toEqual([{ platform: "threads", status: "connected" }]);

  const row = panel.getByTestId("settings-account").filter({ hasText: "Threads" });
  await row.getByRole("button", { name: "Disconnect" }).click();
  await row.getByRole("button", { name: "Disconnect Threads" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Threads is disconnected." })).toBeVisible();
  await expect(row.getByRole("button", { name: "Connect Threads" })).toBeVisible();
  await expect.poll(async () => (await db.from("social_accounts").select("id").eq("user_id", user.id)).data).toEqual([]);
});

test("a schedule card is approved; dragging its slot to another day asks again with a new card", async ({ page }) => {
  const db = admin();
  const user = await founder(db);
  await connectX(db, user.id);
  const { slot } = await approvedPost(db, user, "X", "Cut a demo by deleting words. No timeline.");
  expect(slot).toMatchObject({ platform: "x", mode: "publish", status: "proposed" });

  await signIn(page, user);
  const card = await openCard(page, slot.approval_id!);
  await expect(card).toContainText("You approve when it posts");
  await card.getByRole("button", { name: "Approve time" }).click();
  await expect.poll(async () => (await db.from("schedule_slots").select("status").eq("id", slot.id).single()).data?.status).toBe("waiting");

  await page.goto(`/app/schedule?from=${mondayOf(slot.publish_at)}`);
  const days = page.locator(".scr-week-day");
  const index = (new Date(slot.publish_at).getUTCDay() + 6) % 7;
  const target = index === 6 ? 5 : index + 1;
  await page.locator(`[data-slot-id="${slot.id}"] .scr-slot`).dragTo(days.nth(target));
  await expect(page.getByText("New time saved. A new card asks you to approve it.")).toBeVisible();

  await expect.poll(async () => (await db.from("schedule_slots").select("status, approval_id").eq("id", slot.id).single()).data?.approval_id).not.toBe(slot.approval_id);
  const moved = (await db.from("schedule_slots").select("status, publish_at, approval_id").eq("id", slot.id).single()).data!;
  expect(moved.status).toBe("proposed");
  expect(Math.abs(Date.parse(moved.publish_at) - Date.parse(slot.publish_at))).toBe(86_400_000);
  // The new card waits; the founder's earlier approval no longer stands for this slot.
  expect((await db.from("approvals").select("status").eq("id", moved.approval_id!).single()).data?.status).toBe("waiting");
});

test("a failed post shows why and Retry posts it again", async ({ page }) => {
  const db = admin();
  const user = await founder(db);
  await connectX(db, user.id);
  const { slot } = await approvedPost(db, user, "X", "Most AI video tools stop at the first draft.");
  await signIn(page, user);
  await (await openCard(page, slot.approval_id!)).getByRole("button", { name: "Approve time" }).click();
  await expect.poll(async () => (await db.from("schedule_slots").select("status").eq("id", slot.id).single()).data?.status).toBe("waiting");

  // What B3's handler or the webhook records when X refuses it (service role).
  const failed = await db.rpc("publish_status", {
    p_slot: slot.id,
    p_status: "failed",
    p_error: { code: "refused", message: "X refused the post: duplicate content.", retryable: true },
  });
  expect(failed.error).toBeNull();
  const cardId = (await db.from("schedule_slots").select("approval_id").eq("id", slot.id).single()).data!.approval_id!;
  const card = await openCard(page, cardId);
  await expect(card).toContainText("X refused the post: duplicate content.");
  await card.getByRole("button", { name: "Retry" }).click();
  await expect.poll(async () => (await db.from("schedule_slots").select("status").eq("id", slot.id).single()).data?.status).toBe("waiting");
});

test("no LinkedIn account: the card at its time copies and opens LinkedIn, and I posted it publishes the post", async ({ page }) => {
  const db = admin();
  const user = await founder(db);
  const text = "Why we built the editor before anything else.";
  const { itemId, slot } = await approvedPost(db, user, "LinkedIn", text);
  expect(slot).toMatchObject({ platform: "linkedin", mode: "intent" });
  await signIn(page, user);
  await (await openCard(page, slot.approval_id!)).getByRole("button", { name: "Approve time" }).click();
  await expect.poll(async () => (await db.from("schedule_slots").select("status").eq("id", slot.id).single()).data?.status).toBe("waiting");

  // What the sweep does when its time comes (schedule_claim_due's intent branch).
  expect((await db.rpc("publish_status", { p_slot: slot.id, p_status: "intent" })).error).toBeNull();
  const cardId = (await db.from("schedule_slots").select("approval_id").eq("id", slot.id).single()).data!.approval_id!;

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.context().route(/https:\/\/www\.linkedin\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Composer</title>" }));
  const card = await openCard(page, cardId);
  await expect(card).toContainText("No account connected: copy and open.");
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Copy and open LinkedIn" }).click();
  const tab = await popup;
  await expect.poll(() => tab.url()).toContain("linkedin.com/feed/?shareActive=true");
  await tab.close();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);

  await card.getByRole("button", { name: "I posted it" }).click();
  await expect(page.getByText("Marked as posted. Nothing else goes out for it.")).toBeVisible();
  await expect.poll(async () => (await db.from("schedule_slots").select("status").eq("id", slot.id).single()).data?.status).toBe("published");
  await expect.poll(async () => (await db.from("content_items").select("status").eq("id", itemId).single()).data?.status).toBe("published");
});
