/**
 * Connect and disconnect rules with the fake Zernio and an in-memory store: a profile made once, a callback
 * stores only an account Zernio lists under this founder's profile on that platform, Zernio's error text is
 * never shown, and disconnect removes at Zernio before here.
 *
 *     cd apps/web && npx tsx lib/departments/publish/accounts.check.ts
 */
import assert from "node:assert/strict";

import { connectUrl, disconnectAccount, ensureProfile, finishConnect, type AccountRow, type AccountsStore } from "./accounts";
import { createFakePublishAdapter, fakeAccountId, resetFakePublish } from "./fake";
import type { ConnectedAccount, PublishAdapter } from "./types";

function memoryStore() {
  const profiles = new Map<string, string>();
  const rows = new Map<string, AccountRow & { userId: string; handle: string }>();
  const log: string[] = [];
  const store: AccountsStore = {
    async profileId(userId) {
      return profiles.get(userId) ?? null;
    },
    async saveProfile(userId, id) {
      log.push(`saveProfile ${id}`);
      profiles.set(userId, id);
    },
    async saveAccount(userId, a: ConnectedAccount) {
      const id = `row-${a.platform}-${userId}`;
      rows.set(id, { id, userId, platform: a.platform, zernioAccountId: a.zernioAccountId, handle: a.handle });
      return { id };
    },
    async account(id) {
      return rows.get(id) ?? null;
    },
    async removeAccount(id) {
      log.push(`remove ${id}`);
      rows.delete(id);
    },
  };
  return { store, rows, log, profiles };
}

async function main() {
  resetFakePublish();
  const adapter = createFakePublishAdapter();
  const { store, rows, log } = memoryStore();
  const me = { adapter, store, userId: "user-1" };

  // Profile once.
  const p1 = await ensureProfile(me);
  assert.equal(await ensureProfile(me), p1);
  assert.equal(log.filter((l) => l.startsWith("saveProfile")).length, 1);

  // Connect → the fake's OAuth returns to our callback with the account; the callback stores it.
  const link = new URL(await connectUrl(me, "tiktok", "http://127.0.0.1:3000/api/v1/accounts/callback"));
  assert.equal(link.pathname, "/api/v1/accounts/callback");
  assert.equal(link.searchParams.get("platform"), "tiktok");
  const done = await finishConnect(me, link.searchParams);
  assert.deepEqual(done, { kind: "connected", platform: "tiktok", handle: "fake_tiktok" });
  assert.equal(rows.size, 1);

  // A forged callback: someone else's account id, or the right id under another platform, is never stored.
  const other = { adapter, store: memoryStore().store, userId: "user-2" };
  const otherProfile = await ensureProfile(other);
  await adapter.connectLink(otherProfile, "x", "http://127.0.0.1:3000/cb");
  const forged = new URLSearchParams({ platform: "x", connected: "x", accountId: fakeAccountId(otherProfile, "x") });
  assert.equal((await finishConnect(me, forged)).kind, "refused");
  const wrongPlatform = new URLSearchParams({ platform: "x", accountId: fakeAccountId(p1, "tiktok") });
  assert.equal((await finishConnect(me, wrongPlatform)).kind, "refused");
  assert.equal((await finishConnect(me, new URLSearchParams({ platform: "reddit", accountId: "a" }))).kind, "refused");
  assert.equal(rows.size, 1);

  // Zernio's own error text never reaches the page.
  const failed = await finishConnect(me, new URLSearchParams({ platform: "linkedin", error: "access_denied", error_message: "<script>x</script>" }));
  assert.ok(failed.kind === "refused" && failed.message.startsWith("LinkedIn was not connected") && !failed.message.includes("script"));

  // Disconnect: at Zernio first, then here; a second call finds nothing.
  const seen: string[] = [];
  const watching: PublishAdapter = { ...adapter, disconnect: async (id) => void seen.push(`zernio ${id}`) };
  const rowId = [...rows.keys()][0]!;
  assert.equal(await disconnectAccount({ ...me, adapter: watching }, rowId), true);
  assert.deepEqual([...seen, ...log.filter((l) => l.startsWith("remove"))], [`zernio ${fakeAccountId(p1, "tiktok")}`, `remove ${rowId}`]);
  assert.equal(await disconnectAccount(me, rowId), false);

  // Zernio refusing the disconnect leaves the row: nothing is half removed.
  const { store: s2, rows: r2 } = memoryStore();
  await s2.saveAccount("user-3", { zernioAccountId: "acc", platform: "x", handle: "h", avatarUrl: null });
  const broken: PublishAdapter = { ...adapter, disconnect: async () => { throw new Error("down"); } };
  await assert.rejects(disconnectAccount({ adapter: broken, store: s2, userId: "user-3" }, "row-x-user-3"));
  assert.equal(r2.size, 1);

  console.log("account connect checks passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
