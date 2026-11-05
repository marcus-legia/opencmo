/**
 * Creem's webhook signature and envelope, on real test-mode bodies (`fixtures/creem-deliveries.json`). The expected
 * signatures were computed outside this code, so a bug here cannot agree with itself.
 *
 *     tsx lib/creem-signature.check.ts
 */
import assert from "node:assert/strict";

import { creemApiBase, parseEvent, verifySignature } from "./creem";
import fixture from "./fixtures/creem-deliveries.json";

assert.ok(fixture.deliveries.length >= 8);
for (const { body, signature } of fixture.deliveries) {
  assert.deepEqual(verifySignature(body, signature, fixture.key), { ok: true });
  // A changed body, another key, or no signature at all: refused.
  assert.equal(verifySignature(`${body} `, signature, fixture.key).ok, false);
  assert.equal(verifySignature(body, signature, "another secret").ok, false);
  assert.equal(verifySignature(body, null, fixture.key).ok, false);
  assert.equal(verifySignature(body, "not hex", fixture.key).ok, false);
  const event = parseEvent(body);
  assert.ok(event, "a real delivery parses");
  assert.ok(event.id.startsWith("evt_"));
  assert.ok(event.createdAt.getFullYear() >= 2026, "created_at is epoch milliseconds");
}

const types = new Set(fixture.deliveries.map(({ body }) => parseEvent(body)?.type));
for (const type of ["subscription.paid", "checkout.completed", "subscription.canceled", "refund.created"]) {
  assert.ok(types.has(type), `the fixture covers ${type}`);
}

// The first thing to arrive for a new subscription is `subscription.paid`, and it can stand alone.
const first = parseEvent(fixture.deliveries[0].body);
assert.equal(first?.type, "subscription.paid");
assert.equal(typeof first?.object.last_transaction_id, "string");
assert.equal((first?.object.metadata as { user_id?: unknown } | undefined)?.user_id, "00000000-0000-4000-8000-000000000001");

for (const broken of ["", "not json", "null", "{}", '{"id":"e","eventType":"x","created_at":"soon","object":{}}', '{"id":"e","eventType":"x","created_at":1,"object":[]}']) {
  assert.equal(parseEvent(broken), null, broken);
}

assert.equal(creemApiBase("creem_test_abc"), "https://test-api.creem.io");
assert.equal(creemApiBase("creem_abc"), "https://api.creem.io");

console.log("creem-signature.check ok");
