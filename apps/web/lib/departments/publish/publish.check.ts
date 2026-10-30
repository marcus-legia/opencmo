/**
 * The publish adapter's contract against the fake: one post per idempotency key, failures as results,
 * connect → accounts → disconnect, slot fields that must match the platform, and the intent fallback.
 *
 *     cd apps/web && npx tsx lib/departments/publish/publish.check.ts
 */
import assert from "node:assert/strict";

import { publishAdapter } from "./adapter";
import { fakeAccountId, fakePublishCount, resetFakePublish } from "./fake";
import { intentFor } from "./intent";
import { PublishDeliverableSchema, PublishError, PublishSlotSchema, type PublishDeliverable, type PublishSlot } from "./types";

async function main() {
  assert.throws(() => publishAdapter({}), (e: unknown) => e instanceof PublishError && e.code === "not_configured");

  resetFakePublish();
  const fake = publishAdapter({ OPENCMO_PUBLISH_FAKE: "1" });
  assert.equal(fake.name, "fake");

  const { zernioProfileId } = await fake.createProfile("00000000-0000-4000-8000-000000000001");
  const back = new URL((await fake.connectLink(zernioProfileId, "tiktok", "http://127.0.0.1:3000/api/v1/accounts/callback?platform=tiktok")).url);
  assert.equal(back.searchParams.get("accountId"), fakeAccountId(zernioProfileId, "tiktok"));
  await fake.connectLink(zernioProfileId, "x", "http://127.0.0.1:3000/api/v1/accounts/callback");
  assert.deepEqual((await fake.accounts(zernioProfileId)).map((a) => a.platform).sort(), ["tiktok", "x"]);

  const info = await fake.creatorInfo(fakeAccountId(zernioProfileId, "tiktok"));
  assert.ok(info.privacyLevels.includes("SELF_ONLY") && info.canPostMore);
  await assert.rejects(fake.creatorInfo(fakeAccountId(zernioProfileId, "x")), (e: unknown) => e instanceof PublishError && e.code === "invalid");

  const post: PublishDeliverable = { id: "00000000-0000-4000-8000-0000000000a1", kind: "post", text: "Shipped captions today.", title: null, media: [] };
  const slot: PublishSlot = {
    id: "00000000-0000-4000-8000-0000000000b1",
    platform: "x",
    zernioAccountId: fakeAccountId(zernioProfileId, "x"),
    idempotencyKey: "slot-b1-attempt",
    publishAt: "2026-11-02T09:00:00Z",
    fields: { platform: "x", aiGenerated: false },
  };

  // Never twice: a retried order with the same key gets the first answer and posts nothing new.
  const first = await fake.publish(post, slot);
  assert.equal(first.status, "published");
  assert.deepEqual(await fake.publish(post, slot), first);
  assert.equal(fakePublishCount(), 1);

  // Refusals come back as results with English reasons for the card, never as throws.
  const invalid = await fake.publish({ ...post, text: "Bad [fake:invalid]" }, { ...slot, idempotencyKey: "slot-b1-invalid" });
  assert.ok(invalid.status === "failed" && invalid.error.code === "invalid" && !invalid.error.retryable);
  const down = await fake.publish({ ...post, text: "Later [fake:down]" }, { ...slot, idempotencyKey: "slot-b1-down" });
  assert.ok(down.status === "failed" && down.error.retryable);
  // Zernio did not take it, so the same key may post once it is back.
  assert.equal((await fake.publish(post, { ...slot, idempotencyKey: "slot-b1-down" })).status, "published");

  const webhook = publishAdapter({ OPENCMO_PUBLISH_FAKE: "1", OPENCMO_PUBLISH_FAKE_CONFIRM: "webhook" });
  assert.equal((await webhook.publish(post, { ...slot, idempotencyKey: "slot-b1-webhook" })).status, "accepted");

  // Disconnect forgets the account: a waiting slot on it fails with "connect it again".
  await fake.disconnect(slot.zernioAccountId);
  const gone = await fake.publish(post, { ...slot, idempotencyKey: "slot-b1-gone" });
  assert.ok(gone.status === "failed" && gone.error.code === "not_found" && gone.error.message.includes("X account"));

  // Contracts: fields must be for the slot's platform; TikTok's fields are all required; a short needs its video.
  assert.equal(PublishSlotSchema.safeParse({ ...slot, fields: { platform: "threads", aiGenerated: false } }).success, false);
  assert.equal(PublishSlotSchema.safeParse({ ...slot, platform: "tiktok", fields: { platform: "tiktok", aiGenerated: false } }).success, false);
  assert.equal(
    PublishSlotSchema.safeParse({
      ...slot,
      platform: "tiktok",
      fields: { platform: "tiktok", privacy: "SELF_ONLY", allowComment: true, allowDuet: null, allowStitch: null, aiGenerated: true },
    }).success,
    true,
  );
  assert.equal(PublishSlotSchema.safeParse({ ...slot, platform: "reddit" }).success, false, "Sales has no post button");
  assert.equal(PublishDeliverableSchema.safeParse({ ...post, kind: "short" }).success, false);

  // Fallback: X and Threads take the text, LinkedIn is copied first, video platforms have none.
  assert.equal(intentFor("x", "a b&c")?.url, "https://x.com/intent/post?text=a%20b%26c");
  assert.ok(intentFor("threads", "hi")?.url.startsWith("https://www.threads.com/intent/post?text=hi"));
  assert.equal(intentFor("linkedin", "hi")?.copy, true);
  assert.equal(intentFor("tiktok", "hi"), null);

  console.log("publish adapter checks passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
