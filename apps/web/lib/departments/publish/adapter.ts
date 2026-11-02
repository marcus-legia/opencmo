/**
 * Which publish adapter runs. `OPENCMO_PUBLISH_FAKE=1` picks the fake (tests, e2e, the acceptance run;
 * `OPENCMO_PUBLISH_FAKE_CONFIRM=webhook` makes it wait for the webhook). Zernio runs only when both
 * `ZERNIO_API_KEY` and `OPENCMO_PUBLISH_LIVE=1` are set: the key alone (it sits in `.env.local`, which
 * points at production) never starts real posting before the owner's gates (plan §6) are done.
 */

import { createFakePublishAdapter } from "./fake";
import { PublishError, type PublishAdapter } from "./types";
import { createZernioAdapter } from "./zernio";

export function publishAdapter(env: Record<string, string | undefined> = process.env): PublishAdapter {
  if (env.OPENCMO_PUBLISH_FAKE === "1") {
    return createFakePublishAdapter({
      confirm: env.OPENCMO_PUBLISH_FAKE_CONFIRM === "webhook" ? "webhook" : "now",
      uploadBase: env.OPENCMO_PUBLISH_FAKE_UPLOAD_BASE || undefined,
    });
  }
  const apiKey = env.ZERNIO_API_KEY?.trim();
  if (apiKey && env.OPENCMO_PUBLISH_LIVE === "1") return createZernioAdapter({ apiKey });
  throw new PublishError("not_configured", "Posting from OpenCMO is not set up yet. Use copy and open for now.", false);
}
