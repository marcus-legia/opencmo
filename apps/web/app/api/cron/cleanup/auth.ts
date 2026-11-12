import "server-only";

import { secretAuthorized } from "@/lib/cron-auth";

/**
 * The cleanup route deletes users and their files, so it takes its own secret,
 * `CRON_CLEANUP_SECRET`, never the `CRON_SECRET` the CMO routes share: a leak of that one (it is in
 * every worker container) cannot delete accounts. Closed when the secret is missing (`secretAuthorized`).
 */
export function cleanupAuthorized(authorization: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return secretAuthorized(authorization, "CRON_CLEANUP_SECRET", "cleanup", env);
}
