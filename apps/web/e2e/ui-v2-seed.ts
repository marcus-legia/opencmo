import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { E2EUser } from "./global-setup";
import { state } from "./helpers";

/**
 * The v2 specs need founders past Setup: `/app` sends a founder with no documents to `/app/setup`. One product
 * document is enough; a second run finds it and inserts nothing.
 */
export async function ensureOnboarded(): Promise<void> {
  const { url, service, users } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  for (const user of [users.a, users.b]) {
    const { error } = await admin.from("marketing_documents").upsert(
      { user_id: user.id, kind: "product", version: 1, created_by: "user", body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } },
      { onConflict: "user_id,kind,version", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Could not seed a document: ${error.message}`);
  }
}

/**
 * A founder at the end of one cron day of the daily core drafts (core-drafts follow-ups Task 1): plan X 1 + Threads 1 +
 * LinkedIn 1, X and Threads connected, and today's post for the three platforms waiting on its card, filed under its
 * order as the runner files it. Inserting the item in review raises its card with a time on X.
 */
export async function seedCoreDraft(): Promise<{ user: E2EUser; itemId: string; cardId: string }> {
  const { url, service } = state();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const user: E2EUser = { email: `core-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw new Error(`Could not create a founder: ${created.error.message}`);
  user.id = created.data.user!.id;
  const must = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`Could not seed ${what}: ${r.error.message}`);
  };
  must(await db.from("profiles").update({ plan: "starter", timezone: "UTC", credit_balance: 20,
    posting_plan: { text: { x: 1, threads: 1, linkedin: 1, facebook: 0 }, video: { tiktok: 0, instagram: 0, youtube: 0 } } }).eq("id", user.id), "the plan");
  must(await db.from("marketing_documents").insert({ user_id: user.id, kind: "product", version: 1, created_by: "user",
    body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } }), "a document");
  must(await db.rpc("zernio_profile_save", { p_user: user.id, p_profile: `prof-${user.id}` }), "the Zernio profile");
  for (const platform of ["x", "threads"]) {
    must(await db.rpc("social_account_save", { p_user: user.id, p_platform: platform, p_handle: "@founder", p_avatar_url: null, p_zernio_account_id: `acc-${platform}-${user.id}` }), platform);
  }
  const week = new Date();
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const order = await db.from("work_orders").insert({ user_id: user.id, week: week.toISOString().slice(0, 10), kind: "post_draft",
    title: "Today's post", brief: {}, department: "writer", status: "waiting_founder" }).select("id").single();
  must(order, "the order");
  const itemId = randomUUID();
  must(await db.from("content_items").insert({ id: itemId, user_id: user.id, department: "post", platform: "X", day: new Date().toISOString().slice(0, 10),
    idea: "Invoices get paid on the third reminder", status: "in_review",
    body: { text: "Most late invoices are paid after the third reminder, not the first. Send it on day 14.", alternates: [], targets: ["x", "threads", "linkedin"], slot: 0 } }), "the post");
  must(await db.from("deliverables").insert({ user_id: user.id, order_id: order.data!.id, kind: "post", ref_kind: "content_item", ref_id: itemId, status: "waiting_founder" }), "the deliverable");
  const card = await db.from("approvals").select("id").eq("ref_kind", "content_item").eq("ref_id", itemId).eq("status", "waiting").single();
  must(card, "the card");
  return { user, itemId, cardId: card.data!.id };
}
