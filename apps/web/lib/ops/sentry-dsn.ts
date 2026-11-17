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
const NOT_A_DSN = "NEXT_PUBLIC_SENTRY_DSN is set but is not a valid Sentry DSN (expected https://<key>@<host>/<project id>)";
const WHERE_TO_COPY = "Copy the DSN again from Sentry → Project settings → Client keys";

export const INVALID_DSN_MESSAGE = `${NOT_A_DSN}; Sentry is off. ${WHERE_TO_COPY}, then redeploy (it is inlined at build).`;

/**
 * Fails `next build` when the DSN is set but unparsable (web hardening round 3, item 1): the DSN is inlined into the
 * client bundle at build time, so a bad one found at boot is already a deploy that reports nothing. Unset stays
 * allowed (local, CI). The message names the variable, never its value: the build log is readable by the whole team.
 */
export function assertSentryDsn(raw: string | undefined): void {
  if (readSentryDsn(raw).state === "invalid") {
    throw new Error(`${NOT_A_DSN}. ${WHERE_TO_COPY}, or unset it to build without Sentry.`);
  }
}
