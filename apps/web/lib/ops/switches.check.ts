/** Live switches (cmo-review B1.6): off by default, on only with the owner's gate, never a secret on the page. */
import assert from "node:assert/strict";

import { cmoSwitches } from "./switches";

const byId = (env: Record<string, string | undefined>) => Object.fromEntries(cmoSwitches(env).map((s) => [s.id, s]));

const none = byId({});
for (const id of ["ui_v2", "email", "push", "publish", "zernio_webhook", "social_reader", "cron", "mcp"]) {
  assert.equal(none[id]?.on, false, `${id} is off with an empty env`);
}
assert.equal(none.paused?.on, true, "the brain runs unless the global kill switch is set");

// A key alone never turns posting or email on: the live flag is the owner's gate.
assert.equal(byId({ ZERNIO_API_KEY: "zk-secret" }).publish?.on, false);
assert.equal(byId({ RESEND_API_KEY: "re-secret" }).email?.on, false);
const live = byId({
  NEXT_PUBLIC_OPENCMO_UI: "v2",
  ZERNIO_API_KEY: "zk-secret",
  OPENCMO_PUBLISH_LIVE: "1",
  RESEND_API_KEY: "re-secret",
  OPENCMO_EMAIL_LIVE: "1",
  OPENCMO_CMO_PAUSED: "1",
});
assert.equal(live.ui_v2?.on, true);
assert.equal(live.publish?.on, true);
assert.equal(live.email?.on, true);
assert.equal(live.paused?.on, false);
assert.equal(byId({ OPENCMO_PUBLISH_FAKE: "1" }).publish?.on, false, "the fake adapter is not live posting");

const text = JSON.stringify(cmoSwitches({ ZERNIO_API_KEY: "zk-secret", OPENCMO_PUBLISH_LIVE: "1", RESEND_API_KEY: "re-secret", OPENCMO_EMAIL_LIVE: "1" }));
assert.ok(!text.includes("zk-secret") && !text.includes("re-secret"), "no secret value reaches the page");

console.log("switches: ok");
