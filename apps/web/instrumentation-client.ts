import * as Sentry from "@sentry/nextjs";

import { INVALID_DSN_MESSAGE, readSentryDsn } from "./lib/ops/sentry-dsn";

const sentry = readSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (sentry.state === "ok") {
  Sentry.init({ dsn: sentry.dsn, tracesSampleRate: 0 });
} else if (sentry.state === "invalid") {
  // A warning, not an error: the server's boot log and Live switches carry the alarm; this is for whoever opens devtools.
  console.warn(`[sentry] ${INVALID_DSN_MESSAGE}`);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
