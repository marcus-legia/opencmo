import "server-only";

import { bearerMatches } from "@/lib/cron-auth";

/**
 * The cleanup route deletes users and their files, so it takes its own secret,
 * `CRON_CLEANUP_SECRET`, never the `CRON_SECRET` the CMO routes share: a leak of that one (it is in
 * every worker container) cannot delete accounts.
 *
 * Closed when the secret is MISSING, not only when it is wrong: `.env.example` leaves it empty, and
 * "unset means open" would put a delete endpoint on production after one forgotten line. Empty is
 * accepted only when running locally.
 */
export function cleanupAuthorized(authorization: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_CLEANUP_SECRET;
  if (!secret) {
    if (env.NODE_ENV === "production") {
      console.error("[cron] cleanup: CRON_CLEANUP_SECRET is missing, refusing so the delete endpoint stays closed");
      return false;
    }
    console.warn("[cron] cleanup: no CRON_CLEANUP_SECRET, accepted only because this is a local run");
    return true;
  }
  return bearerMatches(authorization, secret);
}
