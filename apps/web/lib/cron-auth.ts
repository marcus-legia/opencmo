import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Compares a bearer token in constant time.
 *
 * `!==` on strings stops at the first byte that differs, so the answer's timing leaks how many leading characters
 * were right, one byte at a time. Lengths are compared first because `timingSafeEqual` throws when they differ, and
 * a secret's length is not worth hiding.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The one rule of every route a machine calls with a shared secret (the crons, the CMO runner, cleanup): closed when
 * the secret is MISSING in production, not only when it is wrong. `.env.example` leaves these empty, and "unset means
 * open" would put a service-role endpoint on production after one forgotten line. Empty is accepted only locally.
 */
export function secretAuthorized(authorization: string | null, name: string, label: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env[name];
  if (!secret) {
    if (env.NODE_ENV === "production") {
      console.error(`[cron] ${label}: ${name} is missing, refusing so the endpoint stays closed`);
      return false;
    }
    console.warn(`[cron] ${label}: no ${name}, accepted only because this is a local run`);
    return true;
  }
  return bearerMatches(authorization, secret);
}

/** The CMO's crons and its run route, with `CRON_SECRET` (Modal holds it). */
export function cronAuthorized(authorization: string | null, label: string): boolean {
  return secretAuthorized(authorization, "CRON_SECRET", label);
}
