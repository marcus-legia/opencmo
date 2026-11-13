/**
 * The Post image squad on a local stack with a local worker and no providers: post images from a captured page, from
 * nothing, and from a frame that cannot be drawn. The files are saved to look at. The CMO-built slideshow was removed
 * on 2026-11-12 (D7: a slideshow is the founder's own photos). It refuses any Supabase that is not local, because
 * `apps/web/.env.local` is production.
 *
 *     eval "$(supabase status -o env)"; export NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY \
 *       SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_JWT_SECRET=$JWT_SECRET
 *     NODE_OPTIONS=--conditions=react-server npx tsx lib/departments/studio/slideshow/slideshow.e2e.ts <out dir>
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { drainStudioOrders } from "@/lib/cmo/jobs/studio-orders";
import { clientFor } from "@/lib/mcp/auth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):/, "local Supabase only");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

/** A ready page capture of this founder, its screenshot in Storage as the capture task would leave it. */
async function capture(userId: string, out: string): Promise<string> {
  const id = randomUUID();
  const file = join(out, "page.png");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1280x800:d=1", "-frames:v", "1", file]);
  const path = `${userId}/${id}/page.png`;
  const uploaded = await admin.storage.from("captures").upload(path, readFileSync(file), { contentType: "image/png" });
  assert.ifError(uploaded.error);
  const row = await admin.from("page_captures").insert({ id, user_id: userId, url: "https://example.com/", status: "ready", image_path: path, boxes_path: `${userId}/${id}/boxes.json`, width: 1280, height: 800, finished_at: new Date().toISOString() });
  assert.ifError(row.error);
  return id;
}

async function postImage(userId: string, parent: { id: string; week: string }, out: string, name: string, platform: string, source: unknown): Promise<void> {
  const post = await admin.from("content_items").insert({ user_id: userId, department: "post", platform, day: new Date().toISOString().slice(0, 10), idea: name, status: "in_review", body: { text: "We shipped." } }).select("id").single();
  assert.ifError(post.error);
  const postId = (post.data as { id: string }).id;
  const order = await admin.rpc("work_order_create", {
    p_user: userId, p_week: parent.week, p_parent: parent.id, p_kind: "build_post_image", p_title: name,
    p_brief: { postId, title: "Cut a video by deleting words", platform, ...(source ? { source } : {}) },
  });
  assert.ifError(order.error);
  const orderId = (Array.isArray(order.data) ? order.data[0] : order.data).id as string;
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    assert.ok(Date.now() < deadline, `${name}: no image within 3 minutes`);
    await drainStudioOrders(admin as never, { budgetMs: 15_000 });
    const { data: row } = await admin.from("work_orders").select("status, error").eq("id", orderId).single();
    assert.notEqual(row!.status, "failed", JSON.stringify(row!.error));
    if (row!.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const { data: image } = await admin.from("deliverables").select("kind, status, ref_id").eq("post_id", postId).single();
  assert.equal(image!.status, "ready");
  const { data: task } = await admin.from("tasks").select("output").eq("clip_id", image!.ref_id).eq("kind", "render_stills").single();
  const still = (task!.output as { stills: { object: string }[] }).stills[0]!.object;
  const { data, error } = await admin.storage.from("exports").download(still);
  assert.ifError(error);
  writeFileSync(join(out, `${name}.png`), Buffer.from(await data!.arrayBuffer()));
  console.log(`  ✓ ${name}: image deliverable on its post`);
}

async function postImages(userId: string, parent: { id: string; week: string }, out: string): Promise<void> {
  await postImage(userId, parent, out, "image-capture-x", "x", { captureId: await capture(userId, out) });
  await postImage(userId, parent, out, "image-plain-linkedin", "linkedin", null);
  // Looking is not set up on a local stack, so a frame falls back to the plain background instead of failing the post.
  const blank = await clientFor(userId).rpc("create_blank_edit", { p_name: "Source", p_aspect: "9:16" });
  assert.ifError(blank.error);
  await postImage(userId, parent, out, "image-frame-fallback-tiktok", "tiktok_caption", { clipId: blank.data, time: 0 });
}

async function main() {
  const out = process.argv[2] ?? ".";
  mkdirSync(out, { recursive: true });
  const created = await admin.auth.admin.createUser({ email: `p5-slideshow-${Date.now()}@test.local`, email_confirm: true });
  assert.ifError(created.error);
  const userId = created.data.user!.id;
  await admin.from("profiles").update({ credit_balance: 100, plan: "creator" }).eq("id", userId);
  const root = await admin.rpc("work_order_week_root", { p_user: userId });
  assert.ifError(root.error);
  const parent = (Array.isArray(root.data) ? root.data[0] : root.data) as { id: string; week: string };
  await postImages(userId, parent, out);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
