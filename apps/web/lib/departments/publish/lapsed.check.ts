import assert from "node:assert/strict";

import { disconnectLapsed } from "./lapsed";

// Zernio first, then the database; a Zernio failure leaves that account for the next run and goes on with the rest.
async function main() {
  const calls: string[] = [];
  const result = await disconnectLapsed(
    {
      async disconnect(id) {
        calls.push(`zernio:${id}`);
        if (id === "z-bad") throw new Error("Zernio is down");
      },
    },
    {
      async lapsed() {
        return [
          { id: "a1", userId: "u1", zernioAccountId: "z-1" },
          { id: "a2", userId: "u2", zernioAccountId: "z-bad" },
          { id: "a3", userId: "u3", zernioAccountId: "z-3" },
        ];
      },
      async drop(userId, id) {
        calls.push(`drop:${userId}:${id}`);
      },
    },
  );
  assert.deepEqual(result, { dropped: 2, failed: 1 });
  assert.deepEqual(calls, [
    "zernio:z-1",
    "drop:u1:a1",
    "zernio:z-bad",
    "zernio:z-3",
    "drop:u3:a3",
  ]);
  console.log("lapsed.check: ok");
}

void main();
