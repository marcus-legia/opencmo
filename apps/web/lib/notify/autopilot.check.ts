/**
 * The push before an autopilot post (wave 2, B3): the line in the founder's zone, one push per card to each browser,
 * claimed as `push` and recorded; nothing for a paused autopilot, push turned off or no browser.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/notify/autopilot.check.ts
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { autopilotLine, pushAutopilotSoon } from "./autopilot";
import { vapidFromEnv } from "./push";

async function main() {
  assert.equal(autopilotLine({ platform: "x", autoAt: "2026-11-02T07:00:00Z" }, "Asia/Ho_Chi_Minh"), "X post goes out at 14:00. Edit or skip it before then.");
  assert.equal(autopilotLine({ platform: "linkedin", autoAt: "2026-11-02T07:00:00Z" }, "Not/AZone"), "LinkedIn post goes out at 07:00. Edit or skip it before then.");
  assert.equal(autopilotLine({ platform: null, autoAt: "2026-11-02T07:00:00Z" }, "UTC"), "A post goes out at 07:00. Edit or skip it before then.");
  assert.ok(!/—/.test(autopilotLine({ platform: "x", autoAt: "2026-11-02T07:00:00Z" }, "UTC")), "no em dashes");

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  const vapid = vapidFromEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: jwk.d! })!;

  const cards = [
    { id: "c-1", user_id: "u-1", snapshot: { platform: "x" }, auto_at: "2026-11-02T09:00:00Z" },
    { id: "c-2", user_id: "u-paused", snapshot: { platform: "x" }, auto_at: "2026-11-02T09:00:00Z" },
    { id: "c-3", user_id: "u-off", snapshot: { platform: "x" }, auto_at: "2026-11-02T09:00:00Z" },
    { id: "c-4", user_id: "u-nobrowser", snapshot: { platform: "x" }, auto_at: "2026-11-02T09:00:00Z" },
  ];
  const rows: Record<string, unknown[]> = {
    approvals: cards,
    profiles: [
      { id: "u-1", timezone: "UTC", autopilot_paused: false },
      { id: "u-paused", timezone: "UTC", autopilot_paused: true },
      { id: "u-off", timezone: "UTC", autopilot_paused: false },
      { id: "u-nobrowser", timezone: "UTC", autopilot_paused: false },
    ],
    notify_settings: [{ user_id: "u-off", push: false }],
    push_subscriptions: [
      { id: "s-1", user_id: "u-1", endpoint: "https://fcm.googleapis.com/fcm/send/a" },
      { id: "s-2", user_id: "u-1", endpoint: "https://evil.example/push" },
      { id: "s-3", user_id: "u-paused", endpoint: "https://fcm.googleapis.com/fcm/send/b" },
      { id: "s-4", user_id: "u-off", endpoint: "https://fcm.googleapis.com/fcm/send/c" },
    ],
  };
  const filters: string[] = [];
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = () => q;
    q.gt = (col: string, v: string) => (filters.push(`${col}>${v}`), q);
    q.lte = (col: string, v: string) => (filters.push(`${col}<=${v}`), q);
    q.then = (resolve: (v: unknown) => void) => resolve({ data: rows[name] ?? [], error: null });
    return q;
  };
  const calls: [string, Record<string, unknown>][] = [];
  let claimed = false;
  const admin = {
    from: table,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === "email_log_claim") {
        // A second run finds the card already pushed.
        if (claimed) return { data: [], error: null };
        claimed = true;
        return { data: [{ log_id: "log-1", approval_ids: args.p_approval_ids }], error: null };
      }
      return { data: null, error: null };
    },
  };
  const hit: string[] = [];
  const fake = (async (url: string | URL | Request) => (hit.push(String(url)), new Response(null, { status: 201 }))) as typeof fetch;
  const now = new Date("2026-11-02T07:30:00Z");

  assert.equal(await pushAutopilotSoon(admin as never, vapid, fake, { now }), 1);
  assert.deepEqual(filters, ["auto_at>2026-11-02T07:30:00.000Z", "auto_at<=2026-11-02T09:30:00.000Z"], "the two hours before it goes out");
  assert.deepEqual(hit, ["https://fcm.googleapis.com/fcm/send/a"], "only u-1's allowed browser; paused, push off and no browser get nothing");
  const claim = calls.find(([n]) => n === "email_log_claim")![1];
  assert.equal(claim.p_kind, "push");
  assert.deepEqual(claim.p_approval_ids, ["c-1"]);
  assert.equal(claim.p_subject, "X post goes out at 09:00. Edit or skip it before then.");
  assert.equal(calls.filter(([n]) => n === "email_log_claim").length, 1, "nothing is claimed for founders who get no push");
  const done = calls.find(([n]) => n === "email_log_done")![1];
  assert.deepEqual(done, { p_log: "log-1", p_provider_id: "push:1", p_error: null });
  assert.ok(calls.some(([n, a]) => n === "push_done" && a.p_subscription === "s-1" && a.p_status === 201));

  hit.length = 0;
  assert.equal(await pushAutopilotSoon(admin as never, vapid, fake, { now }), 0, "once per card");
  assert.equal(hit.length, 0);

  console.log("autopilot.check: the line, the two-hour window, one push per card, nobody paused or switched off");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
