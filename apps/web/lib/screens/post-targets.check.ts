/**
 * A post card shows every platform the core post goes to and each platform's current rewrite (daily core drafts D3,
 * D4). A rewrite of words the founder has since changed is not shown, as SQL `post_variant_text` does not post it.
 */

import assert from "node:assert/strict";

import type { SupabaseClient } from "@/lib/api/handler";

import { ApprovalCardSchema } from "./approval-card";
import { approvalToCard, type ApprovalRow } from "./cards";
import { coreHash, withPostTargets } from "./schedule-enrich";

const row = (id: string, ref: string, snapshot: Record<string, unknown>): ApprovalRow => ({
  id,
  kind: "post",
  department: "writer",
  ref_kind: "content_item",
  ref_id: ref,
  status: "waiting",
  snapshot,
  content_hash: "a".repeat(64),
  price_credits: null,
  post_at: null,
  account: null,
  expires_at: null,
  created_at: "2026-11-12T03:42:00.000Z",
  decided_at: null,
  decided_via: null,
});

const tables: Record<string, Record<string, unknown>[]> = {
  content_items: [
    { id: "core", body: { text: "The core.", targets: ["x", "linkedin", "facebook"] } },
    { id: "old", body: { text: "An old post." } },
  ],
  post_variants: [
    { item_id: "core", platform: "linkedin", text: "For LinkedIn.", source_hash: coreHash("The core.") },
    { item_id: "core", platform: "facebook", text: "Stale.", source_hash: coreHash("Older words.") },
  ],
};
const fake = {
  from: (table: string) => ({
    select: () => ({ in: async (_col: string, ids: string[]) => ({ data: (tables[table] ?? []).filter((r) => ids.includes(String(r.id ?? r.item_id))), error: null }) }),
  }),
} as unknown as SupabaseClient;

async function main() {
  // Postgres md5() of the same UTF-8 text.
  assert.equal(coreHash(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(coreHash("Tôi"), "a843eb5a5d361aab619a7ca76d8e3b4a");

  const base = { kind: "post", platform: "X", day: "2026-11-12", idea: "Idea", text: "The core.", alternates: [], rationale: "" };
  const cards = [approvalToCard(row("a1", "core", base))!, approvalToCard(row("a2", "old", { ...base, platform: "Threads", text: "An old post." }))!];
  const [core, old] = await withPostTargets(fake, cards);
  assert.ok(core!.body.kind === "post" && old!.body.kind === "post");
  assert.equal(core!.body.itemId, "core", "the card knows its calendar item");
  assert.deepEqual(core!.body.targets, [
    { platform: "x", variant: null },
    { platform: "linkedin", variant: "For LinkedIn." },
    { platform: "facebook", variant: null },
  ], "every target, a current rewrite only");
  assert.deepEqual([core!.body.platforms[0]!.limit, core!.body.platforms[0]!.visibleBeforeMore], [3000, 140], "the core post's limit");
  assert.deepEqual(old!.body.targets, [{ platform: "threads", variant: null }], "an old post goes to its one platform");
  assert.equal(old!.body.platforms[0]!.limit, 500, "and keeps that platform's limit");
  for (const card of [core, old]) ApprovalCardSchema.parse(card);
  console.log("post-targets.check: targets, current rewrites and the core limit on the post card");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
