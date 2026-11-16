/**
 * Reads `NEXT_PUBLIC_SENTRY_DSN` and says whether Sentry can use it (web hardening round 2, item 1).
 *
 * Found 2026-11-16: production's DSN was cut off after `ingest.us.` (no `sentry.io/<project id>`). Sentry's SDK
 * drops a DSN it cannot parse without a word, so for eight days no error, no cron check-in and no uptime signal
 * reached Sentry, and the dashboard looked like a quiet week. This module turns that into a log line at boot and a
 * row on the owner's Live switches page. No imports, so the client and server instrumentation files can both use it.
 */

export type SentryDsnState = { state: "off" } | { state: "ok"; dsn: string } | { state: "invalid" };

/**
 * The shape Sentry's own parser accepts (`@sentry/core` `dsnFromString`): `http(s)://<public key>@<host>/<project id>`,
 * with an optional path prefix before the id for a self-hosted Sentry. A cut-off value fails here as it fails there.
 */
export function readSentryDsn(raw: string | undefined): SentryDsnState {
  const value = raw?.trim();
  if (!value) return { state: "off" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { state: "invalid" };
  }
  const projectId = url.pathname.split("/").pop() ?? "";
  const valid =
    (url.protocol === "https:" || url.protocol === "http:") &&
    /^\w+$/.test(url.username) &&
    !url.password &&
    // Labels separated by dots, `localhost` included; a host ending in a dot is the truncation found in production.
    /^[\w-]+(\.[\w-]+)*$/.test(url.hostname) &&
    /^\d+$/.test(projectId) &&
    !url.search &&
    !url.hash;
  return valid ? { state: "ok", dsn: value } : { state: "invalid" };
}

/** What the boot log says when the DSN is set but unusable. Never the value: the log is searchable by anyone on Vercel. */
export const INVALID_DSN_MESSAGE =
  "NEXT_PUBLIC_SENTRY_DSN is set but is not a valid Sentry DSN (expected https://<key>@<host>/<project id>); " +
  "Sentry is off. Copy the DSN again from Sentry → Project settings → Client keys, then redeploy (it is inlined at build).";
