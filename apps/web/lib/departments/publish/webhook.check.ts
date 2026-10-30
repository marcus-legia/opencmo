/**
 * Zernio webhook: signature (bad, missing, wrong secret), the signed event id used against replays, and the
 * mapping of each event to a slot or account update.
 *
 *     cd apps/web && npx tsx lib/departments/publish/webhook.check.ts
 */
import assert from "node:assert/strict";

import { parseZernioEvent, signZernio, verifyZernioSignature, WebhookPayloadError } from "./webhook";

const SECRET = "whsec_test";
const SLOT = "00000000-0000-4000-8000-0000000000b1";

const published = JSON.stringify({
  id: "evt_1",
  event: "post.platform.published",
  timestamp: "2026-11-02T09:00:05Z",
  post: { id: "post_1", status: "published", metadata: { opencmoSlotId: SLOT }, platforms: [{ platform: "tiktok", accountId: "acc_tt" }] },
  platform: { name: "tiktok", status: "published", platformPostId: "7300", publishedUrl: "https://www.tiktok.com/@f/video/7300" },
  account: { accountId: "acc_tt", platform: "tiktok", username: "f" },
});

// Signature: exact HMAC of the raw body; anything else is refused.
const sig = signZernio(published, SECRET);
assert.ok(verifyZernioSignature(published, sig, SECRET));
assert.ok(verifyZernioSignature(published, sig.toUpperCase(), SECRET));
assert.ok(!verifyZernioSignature(published, null, SECRET));
assert.ok(!verifyZernioSignature(published, sig, ""), "no secret configured: nothing is accepted");
assert.ok(!verifyZernioSignature(published, signZernio(published, "other"), SECRET));
assert.ok(!verifyZernioSignature(published + " ", sig, SECRET), "a changed body fails");
assert.ok(!verifyZernioSignature(published, `sha256=${sig}`, SECRET));
assert.ok(!verifyZernioSignature(published, "abc", SECRET));

// Published → the slot, with its link and the account it went through.
assert.deepEqual(parseZernioEvent(published), {
  kind: "slot",
  eventId: "evt_1",
  slotId: SLOT,
  zernioAccountId: "acc_tt",
  platform: "tiktok",
  status: "published",
  externalId: "7300",
  url: "https://www.tiktok.com/@f/video/7300",
  error: null,
});

// Failed → a reason in plain words; X arrives as `twitter`.
const failed = parseZernioEvent(
  JSON.stringify({
    id: "evt_2",
    event: "post.platform.failed",
    post: { id: "post_2", metadata: { opencmoSlotId: SLOT } },
    platform: { name: "twitter", status: "failed", error: "Duplicate\ncontent" },
    account: { accountId: "acc_x", platform: "twitter" },
  }),
);
assert.ok(failed.kind === "slot" && failed.status === "failed" && failed.platform === "x" && failed.error === "The platform refused the post: Duplicate content");

const cancelled = parseZernioEvent(JSON.stringify({ id: "evt_3", event: "post.cancelled", post: { id: "p", metadata: { opencmoSlotId: SLOT }, platforms: [{ platform: "linkedin", accountId: "acc_li" }] } }));
assert.ok(cancelled.kind === "slot" && cancelled.status === "failed" && cancelled.zernioAccountId === "acc_li" && cancelled.platform === "linkedin");

// A javascript: or http link never becomes the slot's link.
const sneaky = parseZernioEvent(published.replace("https://www.tiktok.com/@f/video/7300", "javascript:alert(1)"));
assert.ok(sneaky.kind === "slot" && sneaky.url === null);

// Account disconnected at Zernio (revoked on the platform).
assert.deepEqual(parseZernioEvent(JSON.stringify({ id: "evt_4", event: "account.disconnected", account: { accountId: "acc_x" } })), {
  kind: "account",
  eventId: "evt_4",
  zernioAccountId: "acc_x",
  status: "disconnected",
});

// Not ours or not needed: acknowledged, nothing changes.
assert.equal(parseZernioEvent(JSON.stringify({ id: "e5", event: "post.published", post: { metadata: { opencmoSlotId: SLOT } } })).kind, "ignored");
assert.equal(parseZernioEvent(JSON.stringify({ id: "e6", event: "post.platform.published", post: { metadata: {} } })).kind, "ignored");
assert.equal(parseZernioEvent(JSON.stringify({ id: "e7", event: "post.platform.published", post: { metadata: { opencmoSlotId: "1; drop" } } })).kind, "ignored");
assert.equal(parseZernioEvent(JSON.stringify({ id: "e8", event: "webhook.test", test: true })).kind, "ignored");

// Not an event at all.
for (const bad of ["not json", "[]", JSON.stringify({ event: "post.published" }), JSON.stringify({ id: "x".repeat(201), event: "e" })]) {
  assert.throws(() => parseZernioEvent(bad), WebhookPayloadError);
}

console.log("zernio webhook checks passed");
