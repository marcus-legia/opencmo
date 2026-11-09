import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";

/**
 * C1 (owner, 2026-11-09): the week's video is a script the founder records. The plan's video item → Writer's brief
 * with a storyboard → a free script card → "Approve and open in editor" → one blank edit with a marker per beat; the
 * Writer screen opens the same edit again. On the local stack; the brief's run is completed here as Writer would.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

const STORYBOARD = [
  { say: "Your invoice is late.", show: "You, to camera", shot: "talking_head", seconds: 5 },
  { say: "Paylane sends the reminder for you.", show: "Paylane's reminder screen", shot: "screen", seconds: 15 },
  { say: "Try Paylane.", show: "You, to camera", shot: "talking_head", seconds: 10 },
];

test("a script card opens its edit with a marker per beat; nothing builds a video", async ({ page }) => {
  test.setTimeout(180_000);
  const db = admin();
  const email = `e2e-script-${Date.now()}@test.local`;
  const { data: created, error } = await db.auth.admin.createUser({ email, password: "e2e-script-password", email_confirm: true });
  if (error || !created.user) throw new Error(`could not create the founder: ${error?.message}`);
  const userId = created.user.id;
  await db.from("credit_ledger").insert({ user_id: userId, delta: 50, reason: "E2E top-up" });
  // Fresh niche research, so the brief starts at once.
  await db.from("cmo_insights").insert({ user_id: userId, kind: "niche_video", body: {} });
  const { data: run } = await db.from("cmo_runs").insert({ user_id: userId, kind: "plan_week", status: "running" }).select("id").single();
  const planned = await db.rpc("cmo_plan_week", {
    p_user: userId,
    p_run: run!.id,
    p_items: [{ department: "video", platform: "Shorts", day: new Date().toISOString().slice(0, 10), idea: "Chase a late invoice", reason: "Launch week" }],
  });
  expect(planned.error).toBeNull();
  const { data: brief } = await db.from("work_orders").select("id").eq("user_id", userId).eq("kind", "write_video_brief").single();
  expect((await db.from("work_orders").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "build_video")).count).toBe(0);
  await db
    .from("cmo_runs")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      output: { reason: "Brief written", brief: { objective: "Chase a late invoice", hooks: ["Your invoice is late.", "b", "c"], cta: "Try Paylane", seconds: 30, aspect: "9:16", storyboard: STORYBOARD } },
    })
    .eq("input->>order_id", brief!.id);
  const { data: card } = await db.from("approvals").select("id, kind, price_credits").eq("ref_kind", "work_order").eq("ref_id", brief!.id).eq("status", "waiting").single();
  expect([card!.kind, card!.price_credits]).toEqual(["script", 0]);

  await signIn(page, { email, password: "e2e-script-password" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/app/inbox/${card!.id}`);
  const view = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(view).toContainText("Your invoice is late.");
  await expect(view).toContainText("Free: nothing is generated");
  await view.getByRole("button", { name: "Approve and open in editor" }).click();
  await expect(page).toHaveURL(/\/app\/editor\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const clipId = page.url().split("/app/editor/")[1]!.split(/[?#]/)[0]!;

  const { data: project } = await db.from("editor_projects").select("document").eq("clip_id", clipId).single();
  const markers = JSON.stringify(project!.document).match(/"name":"0[1-3] · [A-Za-z ]+"/g) ?? [];
  expect(markers).toEqual(['"name":"01 · To camera"', '"name":"02 · Screen"', '"name":"03 · To camera"']);
  expect((await db.from("approvals").select("status").eq("id", card!.id).single()).data!.status).toBe("approved");

  // The Writer screen opens the same edit again, and places nothing twice.
  await page.goto("/app/writer");
  await page.getByRole("tab", { name: "Video briefs" }).click();
  await page.getByRole("button", { name: "Open in editor →" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/editor/${clipId}`), { timeout: 60_000 });
  const { data: again } = await db.from("editor_projects").select("document").eq("clip_id", clipId).single();
  expect((JSON.stringify(again!.document).match(/"name":"0[1-3] · /g) ?? []).length).toBe(3);
});
