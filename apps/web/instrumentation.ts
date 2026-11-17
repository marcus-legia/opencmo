import * as Sentry from "@sentry/nextjs";

import { errorFields, logEvent } from "./lib/log";
import { INVALID_DSN_MESSAGE, readSentryDsn } from "./lib/ops/sentry-dsn";

/**
 * Server-side Sentry. Without a DSN nothing starts, so local runs and CI need no setup and send nothing. A DSN that is
 * set but malformed is logged at boot: Sentry's SDK drops it silently, which hid a cut-off DSN for eight days.
 */
export function register() {
  const sentry = readSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
  if (sentry.state === "invalid") logEvent("error", "sentry_dsn_invalid", { message: INVALID_DSN_MESSAGE });
  if (sentry.state !== "ok") return;

  Sentry.init({
    dsn: sentry.dsn,
    // No trace sampling: at this stage we need errors, not performance charts, and every trace spends free quota.
    tracesSampleRate: 0,
  });
}

/** Server render errors: `digest` is the only link to what the error boundary reports from the browser. */
export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  logEvent("error", "request_error", {
    ...errorFields(error),
    digest: (error as { digest?: string } | null)?.digest,
    path: request.path?.split("?")[0],
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  });
  return Sentry.captureRequestError(error, request, context);
};
