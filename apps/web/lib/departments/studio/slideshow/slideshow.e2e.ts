/**
 * One Slideshow order on a local stack with a local worker and no providers: order → MP4 and PNG set → one card →
 * approve → deliverable, then the files are saved to look at. It refuses any Supabase that is not local, because
 * `apps/web/.env.local` is production.
 *
 *     eval "$(supabase status -o env)"; export NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY \
 *       SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_JWT_SECRET=$JWT_SECRET
 *     NODE_OPTIONS=--conditions=react-server npx tsx lib/departments/studio/slideshow/slideshow.e2e.ts <out dir>
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { drainStudioOrders } from "@/lib/cmo/jobs/studio-orders";
import { clientFor } from "@/lib/mcp/auth";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):/, "local Supabase only");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const SLIDES = [
  { heading: "Cut a video by deleting words", body: "No timeline needed." },
  { heading: "Upload your own video", body: "Words appear as you speak them." },
  { heading: "Delete a sentence", body: "The video follows the text." },
  { heading: "Add captions in one click", body: "" },
  { heading: "Try it on your next demo", body: "Export when it reads right." },
];

async function main() {
  const out = process.argv[2] ?? ".";
  mkdirSync(out, { recursive: true });
  const created = await admin.auth.admin.createUser({ email: `p5-slideshow-${Date.now()}@test.local`, email_confirm: true });
  assert.ifError(created.error);
  const userId = created.data.user!.id;
  await admin.from("profiles").update({ credit_balance: 100, plan: "creator" }).eq("id", userId);
  const before = (await admin.from("profiles").select("credit_balance").eq("id", userId).single()).data!.credit_balance;

  const root = await admin.rpc("work_order_week_root", { p_user: userId });
  assert.ifError(root.error);
  const parent = (Array.isArray(root.data) ? root.data[0] : root.data) as { id: string; week: string };
  const order = await admin.rpc("work_order_create", {
    p_user: userId, p_week: parent.week, p_parent: parent.id, p_kind: "build_slideshow", p_title: "Editing by words",
    p_brief: { idea: "Cut a video by deleting words", aspect: "9:16", slides: SLIDES },
  });
  assert.ifError(order.error);
  const orderId = (Array.isArray(order.data) ? order.data[0] : order.data).id as string;

  const deadline = Date.now() + 5 * 60_000;
  type Card = { id: string; content_hash: string; snapshot: { clip_id: string; slides: { still_path: string; seconds: number; text: string }[]; mp4_path: string; png_set_path: string } };
  let raised: Card | null = null;
  while (!raised && Date.now() < deadline) {
    await drainStudioOrders(admin as never, { budgetMs: 20_000 });
    const { data: row } = await admin.from("work_orders").select("status, error").eq("id", orderId).single();
    assert.notEqual(row!.status, "failed", JSON.stringify(row!.error));
    const { data } = await admin.from("approvals").select("id, content_hash, snapshot").eq("user_id", userId).eq("kind", "slideshow").maybeSingle();
    raised = data as Card | null;
    if (!raised) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const card = raised as Card | null;
  assert.ok(card, "the card was raised within 5 minutes");
  const snapshot = card.snapshot;
  assert.equal(snapshot.slides.length, SLIDES.length);
  console.log(`  ✓ one card with ${snapshot.slides.length} slides, ${snapshot.slides.reduce((sum, slide) => sum + slide.seconds, 0)} s`);

  for (const [name, path] of [["slideshow.mp4", snapshot.mp4_path], ["slides.zip", snapshot.png_set_path], ...snapshot.slides.map((slide, index) => [`slide-${index + 1}.png`, slide.still_path])] as [string, string][]) {
    const { data, error } = await admin.storage.from("exports").download(path);
    assert.ifError(error);
    writeFileSync(join(out, name), Buffer.from(await data!.arrayBuffer()));
  }
  console.log("  ✓ MP4, zip and every still are in Storage");

  const decided = await clientFor(userId).rpc("approval_decide", { p_id: card.id, p_action: "approve", p_payload: { content_hash: card.content_hash, via: "app" } });
  assert.ifError(decided.error);
  const { data: done } = await admin.from("work_orders").select("status").eq("id", orderId).single();
  assert.equal(done!.status, "done");
  const { data: deliverable } = await admin.from("deliverables").select("kind, status, ref_id").eq("user_id", userId).eq("kind", "slideshow").single();
  assert.deepEqual(deliverable, { kind: "slideshow", status: "ready", ref_id: snapshot.clip_id });
  const after = (await admin.from("profiles").select("credit_balance").eq("id", userId).single()).data!.credit_balance;
  assert.equal(after, before, "the squad spends no credits");
  console.log("  ✓ approved: order done, deliverable ready, no credits spent");
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
