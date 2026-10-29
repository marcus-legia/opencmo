import { createHmac, randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { signIn, state } from "./helpers";

/**
 * P2 Studio on live rows (sessions/C.md C4): Studio cards 1–3 decide through `approval_decide` (a stale hash is
 * refused), Mark finished then an edit clears the badge, and approving a shorts batch puts the shorts in Studio.
 * Rows are made with the same RPCs the adapter and the worker use, so no worker or model runs. v2 build only:
 * `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

/**
 * The founder's session as the brain's Studio order runner sees it (`lib/mcp/auth.ts` `brainClientFor`): only it may
 * store steps and create shorts batches, as the adapter does.
 */
function brainClient(userId: string): SupabaseClient {
  const { url, anon } = state();
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ opencmo_actor: "brain", sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 600 })}`;
  const token = `${body}.${createHmac("sha256", process.env.SUPABASE_JWT_SECRET!).update(body).digest("base64url")}`;
  return createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}

/** A founder of its own per test, past Setup and with credits for the keyframe hold. */
async function founder(db: SupabaseClient): Promise<{ user: E2EUser; me: SupabaseClient }> {
  const { url, anon } = state();
  const user = { email: `studio-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  expect(created.error).toBeNull();
  user.id = created.data.user!.id;
  await db.from("profiles").update({ credit_balance: 500, plan: "creator" }).eq("id", user.id);
  const doc = await db
    .from("marketing_documents")
    .insert({ user_id: user.id, kind: "product", version: 1, created_by: "user", body: { name: "OpenCMO", one_liner: "An AI CMO for solo founders." } });
  expect(doc.error).toBeNull();
  const me = createClient(url, anon, { auth: { persistSession: false } });
  expect((await me.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
  return { user, me };
}

/** An edit (blank clip + document) the way a brain-made video starts. */
async function edit(db: SupabaseClient, userId: string, name: string) {
  const jobId = randomUUID();
  const clipId = randomUUID();
  const document = { version: 1, stage: { name } };
  // A blank edit's job, as `create_blank_edit` makes it.
  expect((await db.from("jobs").insert({ id: jobId, user_id: userId, kind: "edit", source_url: "editor://blank", duration_seconds: 60, status: "done" })).error).toBeNull();
  expect((await db.from("clips").insert({ id: clipId, job_id: jobId, idx: -1, hook: name, start_seconds: 0, end_seconds: 0, kind: "blank" })).error).toBeNull();
  expect((await db.from("editor_projects").insert({ clip_id: clipId, document })).error).toBeNull();
  return { jobId, clipId, hash: await hashOf(db, document) };
}

async function hashOf(db: SupabaseClient, document: object): Promise<string> {
  const { data, error } = await db.rpc("editor_document_hash", { p_document: document });
  expect(error).toBeNull();
  return data as string;
}

/** A `build_video` order under the week's root, in the state the runner leaves it while a card waits. */
async function videoOrder(db: SupabaseClient, userId: string, title: string): Promise<string> {
  const week = new Date();
  week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
  const p_week = week.toISOString().slice(0, 10);
  const root = await db.rpc("work_order_create", { p_user: userId, p_week, p_parent: null, p_kind: "plan_week", p_title: "Week", p_budget: 100 });
  expect(root.error).toBeNull();
  const { data: rootRow } = await db.from("work_orders").select("id").eq("user_id", userId).is("parent_id", null).single();
  const created = await db.rpc("work_order_create", {
    p_user: userId,
    p_week,
    p_parent: rootRow!.id,
    p_kind: "build_video",
    p_title: title,
    p_brief: { seconds: 60 },
    p_budget: 60,
    p_department: "studio",
  });
  expect(created.error).toBeNull();
  const { data: order } = await db.from("work_orders").select("id").eq("user_id", userId).eq("kind", "build_video").order("created_at", { ascending: false }).limit(1).single();
  expect((await db.rpc("work_order_move", { p_id: order!.id, p_to: "running" })).error).toBeNull();
  return order!.id as string;
}

async function waitingCard(db: SupabaseClient, refKind: string, refId: string) {
  const { data } = await db.from("approvals").select("id, content_hash, status").eq("ref_kind", refKind).eq("ref_id", refId).eq("status", "waiting").maybeSingle();
  return data as { id: string; content_hash: string; status: string } | null;
}

async function cardPage(page: Page, id: string) {
  await page.goto(`/app/inbox/${id}`);
  const card = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(card).toBeVisible();
  return card;
}

test("Studio cards 1–3 decide live: a stale hash is refused, a beat is edited, a keyframe redone, the video finished", async ({ page }) => {
  const db = admin();
  const { user } = await founder(db);
  // The cards decide live; the steps behind them are this test's own rows, which the order runner the approvals
  // route kicks cannot carry out. Paused, the runner leaves them alone (the cards still decide).
  expect((await db.from("profiles").update({ cmo_paused_at: new Date().toISOString() }).eq("id", user.id)).error).toBeNull();
  const video = await edit(db, user.id, "How the CMO plans a week");
  const orderId = await videoOrder(db, user.id, "How the CMO plans a week");

  // Card 1: the storyboard, raised by the adapter under the founder's session.
  const { data: script, error: scriptError } = await brainClient(user.id).rpc("studio_step_raise", {
    p_clip_id: video.clipId,
    p_tool: "create_video",
    p_kind: "script",
    p_input: { plan: "prepared" },
    p_card: {
      title: "How the CMO plans a week",
      seconds: 60,
      aspect: "9:16",
      beats: [
        { words: "You recorded the demo.", picture: "Desk, laptop.", motion: "Slow push in." },
        { words: "Now cut it by words.", picture: "Transcript lines fade out.", motion: null },
      ],
    },
    p_price_credits: 6,
    p_order_id: orderId,
  });
  expect(scriptError).toBeNull();
  const scriptId = (script as { id: string }).id;
  const card1 = await waitingCard(db, "studio_step", scriptId);
  expect(card1).not.toBeNull();

  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // A screen that shows an older card is refused by the route the cards use.
  const stale = await page.request.post(`/api/v1/approvals/${card1!.id}`, { data: { action: "approve", contentHash: "0".repeat(64) } });
  expect(stale.ok()).toBeFalsy();
  expect(JSON.stringify(await stale.json())).toMatch(/changed/);

  let card = await cardPage(page, card1!.id);
  await expect(card).toContainText("Now cut it by words.");
  await expect(card).toContainText("Motion: Slow push in.");
  await card.getByRole("button", { name: "Edit a beat" }).click();
  await card.getByLabel("Beat", { exact: true }).selectOption("1");
  await card.getByLabel("What is said in this beat").fill("Cut it by deleting words.");
  await card.getByRole("button", { name: "Approve edit" }).click();
  await expect.poll(async () => (await db.from("approvals").select("status").eq("id", card1!.id).single()).data?.status).toBe("edited");
  await expect
    .poll(async () => (await db.from("studio_steps").select("decision_payload").eq("id", scriptId).single()).data?.decision_payload)
    .toMatchObject({ beat: 1, text: "Cut it by deleting words." });

  // Card 2: the contact sheet; redo one keyframe.
  const { data: sheet, error: sheetError } = await brainClient(user.id).rpc("studio_step_raise", {
    p_clip_id: video.clipId,
    p_tool: "animate_video",
    p_kind: "price",
    p_input: { plan: "prepared" },
    p_card: {
      title: "How the CMO plans a week",
      what: "Long video “How the CMO plans a week”",
      seconds: 60,
      wait_minutes: 25,
      shots: 2,
      keyframes: [
        { index: 0, words: "You recorded the demo.", path: null, garbled: false, credits: 1 },
        { index: 1, words: "Cut it by deleting words.", path: null, garbled: true, credits: 1 },
      ],
    },
    p_price_credits: 24,
    p_order_id: orderId,
  });
  expect(sheetError).toBeNull();
  const sheetId = (sheet as { id: string }).id;
  const card2 = await waitingCard(db, "studio_step", sheetId);
  card = await cardPage(page, card2!.id);
  await expect(card).toContainText("Text may be garbled");
  await card.getByRole("button", { name: "Redo a keyframe" }).click();
  await card.getByRole("radio", { name: /Keyframe 02/ }).check();
  await card.getByRole("button", { name: "Redo keyframe 2" }).click();
  await expect.poll(async () => (await db.from("studio_steps").select("decision, decision_payload").eq("id", sheetId).single()).data).toMatchObject({
    decision: "redo",
    decision_payload: { index: 1 },
  });

  // Card 3: the render of the edit as it is now raises the finished video; approving marks it finished.
  await db.from("studio_steps").insert({
    user_id: user.id,
    clip_id: video.clipId,
    tool: "animate_video",
    kind: "price",
    input: {},
    card: { seconds: 60 },
    price_credits: 24,
    order_id: orderId,
    status: "done",
    decision: "approve",
    // What the order runner records once the shots are made: the render comes next.
    next: { tool: "render" },
  });
  const taskId = randomUUID();
  expect(
    (
      await db.from("tasks").insert({
        id: taskId,
        user_id: user.id,
        kind: "render_document",
        clip_id: video.clipId,
        job_id: video.jobId,
        status: "running",
        request_id: randomUUID(),
        payload: {},
        settings_hash: video.hash,
        duration: 60,
      })
    ).error,
  ).toBeNull();
  await db.from("tasks").update({ status: "done", output_path: `${user.id}/e2e.mp4`, finished_at: new Date().toISOString() }).eq("id", taskId);
  const card3 = await waitingCard(db, "editor_project", video.clipId);
  expect(card3).not.toBeNull();
  card = await cardPage(page, card3!.id);
  await expect(card.getByRole("link", { name: "Open in editor" })).toHaveAttribute("href", `/app/editor/${video.clipId}`);
  await card.getByRole("button", { name: "Approve: finished" }).click();
  await expect.poll(async () => (await db.from("editor_projects").select("finished_hash").eq("clip_id", video.clipId).single()).data?.finished_hash).toBe(video.hash);
  await expect.poll(async () => (await db.from("work_orders").select("status").eq("id", orderId).single()).data?.status).toBe("done");
});

test("Mark finished on Studio shows the badge; an edit after it clears it", async ({ page }) => {
  const db = admin();
  const { user } = await founder(db);
  const video = await edit(db, user.id, "Editor launch");
  const orderId = await videoOrder(db, user.id, "Editor launch");
  // The order's step ties the edit to the Studio item.
  await db.from("studio_steps").insert({
    user_id: user.id,
    clip_id: video.clipId,
    tool: "animate_video",
    kind: "price",
    input: {},
    card: { seconds: 60 },
    price_credits: 24,
    order_id: orderId,
    status: "done",
    decision: "approve",
    // The video is built: its render comes next, so Studio offers Mark finished.
    next: { tool: "render" },
  });

  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/studio?kind=video");
  const item = page.locator("article.scr-card").filter({ hasText: "Editor launch" });
  await item.getByTestId("studio-mark-finished").click();
  await expect(item.getByText("Finished", { exact: true })).toBeVisible();
  await expect(item.getByTestId("studio-cut-shorts")).toBeVisible();
  expect((await db.from("editor_projects").select("finished_hash").eq("clip_id", video.clipId).single()).data?.finished_hash).toBe(video.hash);

  // Any later edit of the document clears the mark (A3's trigger); Studio shows it after a reload.
  await db.from("editor_projects").update({ document: { version: 1, stage: { name: "Editor launch v2" } } }).eq("clip_id", video.clipId);
  await page.reload();
  await expect(item.getByTestId("studio-mark-finished")).toBeVisible();
  await expect(item.getByText("Finished", { exact: true })).toHaveCount(0);
});

test("approving a shorts batch puts the three shorts in Studio", async ({ page }) => {
  const db = admin();
  const { user, me } = await founder(db);
  const parent = await edit(db, user.id, "Cut by words");
  expect((await me.rpc("mark_finished", { p_clip_id: parent.clipId, p_document_hash: parent.hash })).error).toBeNull();
  const { data: order } = await db.from("work_orders").select("id").eq("user_id", user.id).eq("kind", "cut_shorts").single();

  const ranges = [
    { start: 0, end: 22, hook: "Cut by words", reason: "Opens on the pain" },
    { start: 18, end: 41, hook: "B-roll on the line", reason: "Shows the command" },
    { start: 38, end: 60, hook: "Edit by asking", reason: "Strongest demo" },
  ];
  const { data: batch, error } = await brainClient(user.id).rpc("short_batch_create", {
    p_parent_clip_id: parent.clipId,
    p_parent_hash: parent.hash,
    p_order_id: order!.id,
    p_shorts: ranges.map((r, i) => ({ source_start: r.start, source_end: r.end, hook: r.hook, title: r.hook, reason: r.reason, document: { version: 1, stage: { name: `s${i}` } } })),
  });
  expect(error).toBeNull();
  const batchId = (batch as { batch_id: string }).batch_id;
  const { data: shorts } = await db.from("shorts").select("short_clip_id").eq("batch_id", batchId);
  expect(shorts).toHaveLength(3);
  // The worker renders each short as its own edit; when all are done the batch card waits.
  for (const short of shorts!) {
    const id = randomUUID();
    await db.from("tasks").insert({ id, user_id: user.id, kind: "render_document", clip_id: short.short_clip_id, job_id: parent.jobId, status: "running", request_id: randomUUID(), payload: {} });
    await db.from("tasks").update({ status: "done", output_path: `${user.id}/${id}.mp4` }).eq("id", id);
  }
  const card = await waitingCard(db, "short_batch", batchId);
  expect(card).not.toBeNull();

  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const shown = await cardPage(page, card!.id);
  await expect(shown).toContainText("Opens on the pain");
  await expect(shown).toContainText("Hook: “Edit by asking”");
  await shown.getByRole("button", { name: "Approve batch" }).click();
  await expect.poll(async () => (await db.from("deliverables").select("id").eq("user_id", user.id).eq("kind", "short")).data?.length).toBe(3);

  await page.goto("/app/studio?kind=short");
  const item = page.locator("article.scr-card").filter({ hasText: "3 shorts" });
  await expect(item).toBeVisible();
  await expect(item.getByText("Finished", { exact: true })).toBeVisible();
});
