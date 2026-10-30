/**
 * Which publish adapter runs. `OPENCMO_PUBLISH_FAKE=1` picks the fake (tests, e2e, the acceptance run;
 * `OPENCMO_PUBLISH_FAKE_CONFIRM=webhook` makes it wait for the webhook). Anything else is Zernio, which
 * stays refused until B1 lands and the owner gates (plan §6) are done.
 */

import { createFakePublishAdapter } from "./fake";
import { PublishError, type PublishAdapter } from "./types";

export function publishAdapter(env: Record<string, string | undefined> = process.env): PublishAdapter {
  if (env.OPENCMO_PUBLISH_FAKE === "1") {
    return createFakePublishAdapter({ confirm: env.OPENCMO_PUBLISH_FAKE_CONFIRM === "webhook" ? "webhook" : "now" });
  }
  throw new PublishError("not_configured", "Posting from OpenCMO is not set up yet. Use copy and open for now.", false);
}
